"""
Verifiable doctor reports: a small PKI, the same idea a hospital or a cloud PKI (e.g. Keytos EZCA) uses.

    NeuroTrail Local Root CA  (P-256, 10 years, CA:true)        data/keys/root.{key,crt}
          └── NeuroTrail Report Signing  (P-256, 2 years)        data/keys/signing.{key,crt}
                    └── signs each report (ECDSA P-256 / SHA-256 over canonical JSON)

Keys are created on first use and never leave this computer (data/keys/ is git-ignored).
The verify page checks the signature in the browser with WebCrypto using the signing certificate's
public key, and the server checks the certificate chain up to the root. Change one byte of a signed
report and verification fails.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import os
from functools import lru_cache
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature
from cryptography.x509.oid import NameOID

KEYDIR = Path(os.environ.get("NT_KEYDIR", Path(__file__).resolve().parents[1] / "data" / "keys"))
b64 = lambda b: base64.b64encode(b).decode()


def canonical(obj) -> str:
    """The exact bytes that get signed: sorted keys, no spaces, ASCII only."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _name(cn: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.ORGANIZATION_NAME, "NeuroTrail"), x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def _write(path: Path, data: bytes, secret: bool = False) -> None:
    path.write_bytes(data)
    if secret:
        path.chmod(0o600)


def _create() -> None:
    KEYDIR.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc)
    root_key = ec.generate_private_key(ec.SECP256R1())
    root = (x509.CertificateBuilder().subject_name(_name("NeuroTrail Local Root CA")).issuer_name(_name("NeuroTrail Local Root CA"))
            .public_key(root_key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(minutes=5)).not_valid_after(now + dt.timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False, key_encipherment=False, data_encipherment=False,
                                         key_agreement=False, key_cert_sign=True, crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(root_key.public_key()), critical=False)
            .sign(root_key, hashes.SHA256()))
    key = ec.generate_private_key(ec.SECP256R1())
    cert = (x509.CertificateBuilder().subject_name(_name("NeuroTrail Report Signing")).issuer_name(root.subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(minutes=5)).not_valid_after(now + dt.timedelta(days=730))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=True, key_encipherment=False, data_encipherment=False,
                                         key_agreement=False, key_cert_sign=False, crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(root_key.public_key()), critical=False)
            .sign(root_key, hashes.SHA256()))
    pem_key = lambda k: k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    _write(KEYDIR / "root.key", pem_key(root_key), secret=True)
    _write(KEYDIR / "root.crt", root.public_bytes(serialization.Encoding.PEM))
    _write(KEYDIR / "signing.key", pem_key(key), secret=True)
    _write(KEYDIR / "signing.crt", cert.public_bytes(serialization.Encoding.PEM))


@lru_cache
def _material():
    if not (KEYDIR / "signing.key").exists():
        _create()
    key = serialization.load_pem_private_key((KEYDIR / "signing.key").read_bytes(), password=None)
    cert = x509.load_pem_x509_certificate((KEYDIR / "signing.crt").read_bytes())
    root = x509.load_pem_x509_certificate((KEYDIR / "root.crt").read_bytes())
    return key, cert, root


def reset_cache() -> None:
    _material.cache_clear()


def sign(payload: dict) -> dict:
    key, _, _ = _material()
    text = canonical(payload)
    der = key.sign(text.encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return {"payload_json": text, "digest": hashlib.sha256(text.encode()).hexdigest(),
            "sig_der": b64(der), "sig_raw": b64(r.to_bytes(32, "big") + s.to_bytes(32, "big"))}


def verify(payload_json: str, sig_der_b64: str) -> bool:
    _, cert, _ = _material()
    try:
        cert.public_key().verify(base64.b64decode(sig_der_b64), payload_json.encode(), ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:  # noqa: BLE001
        return False


def raw_to_der(sig_raw_b64: str) -> str:
    raw = base64.b64decode(sig_raw_b64)
    return b64(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")))


def chain() -> dict:
    """What the verify page shows: both certificates, fingerprints, and whether the chain checks out."""
    _, cert, root = _material()
    try:
        root.public_key().verify(cert.signature, cert.tbs_certificate_bytes, ec.ECDSA(cert.signature_hash_algorithm))
        ok = cert.issuer == root.subject
    except Exception:  # noqa: BLE001
        ok = False
    now = dt.datetime.now(dt.timezone.utc)
    info = lambda c: {"subject": c.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value,
                      "issuer": c.issuer.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value,
                      "sha256": c.fingerprint(hashes.SHA256()).hex(":").upper(), "not_after": c.not_valid_after_utc.date().isoformat(),
                      "valid_now": c.not_valid_before_utc <= now <= c.not_valid_after_utc,
                      "pem": c.public_bytes(serialization.Encoding.PEM).decode()}
    spki = cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return {"signing": info(cert), "root": info(root), "chain_valid": ok, "spki": b64(spki)}
