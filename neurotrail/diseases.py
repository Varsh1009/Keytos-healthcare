"""
Brain disease atlas: where each disease strikes, how it progresses, and what can be done at home.

Region patterns follow the published staging systems cited for each disease (all checked on PubMed,
2026-11-12), mapped to the nearest Harvard-Oxford atlas regions. Alzheimer's also has a pattern
MEASURED in this project from 436 real OASIS MRI scans (models/build_region_norms.py).
Region mapping to a standard atlas is approximate and illustrative: staging systems describe
microscopic pathology, the atlas has coarse regions. The user's own data is never shown next to stages.
"""
from __future__ import annotations

from . import regions as R

PM = "https://pubmed.ncbi.nlm.nih.gov/"


def _ids(*names: str) -> list[str]:
    by_name = {r["name"]: r["id"] for r in R.regions()}
    ids = set(by_name.values())
    out = []
    for n in names:
        hits = [n] if n in ids else [rid for nm, rid in by_name.items() if nm == n or nm.startswith(n)]
        if not hits:
            raise KeyError(n)
        out += hits
    return out


def catalog() -> list[dict]:
    return [{**d, "doctor": DOCTOR[d["id"]]} for d in _catalog()]


def _catalog() -> list[dict]:
    return [
        {"id": "alzheimers", "group": "lower", "name": "Alzheimer's disease", "icon": "🧩", "color": "#FFB547",
         "what": "The most common cause of dementia. Tangles of tau protein damage nerve cells, starting in memory areas.",
         "varies": "It spreads in a predictable order over many years (Braak stages I–VI). Memory goes first; language, planning and orientation follow.",
         "source": ("Braak & Braak 1991, Acta Neuropathologica: six stages of tangle spread in 83 brains", PM + "1759558"),
         "measured": True,
         "stages": [
             {"label": "Stages I–II", "when": "Often years before symptoms",
              "symptoms": "Usually none, or slightly more forgetful.",
              "regions": _ids("Parahippocampal Gyrus, anterior", "Temporal Fusiform Cortex, anterior")},
             {"label": "Stages III–IV", "when": "Mild memory problems",
              "symptoms": "Forgetting recent events and conversations; repeating questions.",
              "regions": _ids("hippocampus", "amygdala", "Temporal Pole", "Inferior Temporal Gyrus, anterior")},
             {"label": "Stages V–VI", "when": "Dementia",
              "symptoms": "Trouble with words, planning, getting lost, recognizing people.",
              "regions": _ids("Middle Temporal Gyrus", "Inferior Temporal Gyrus, posterior", "Angular Gyrus", "Supramarginal Gyrus",
                              "Precuneous Cortex", "Cingulate Gyrus, posterior", "Middle Frontal Gyrus", "Superior Frontal Gyrus",
                              "Lateral Occipital Cortex, superior")},
         ],
         "home": [
             {"do": "Keep blood pressure under control", "why": "SPRINT MIND: intensive BP control cut mild cognitive impairment risk (HR 0.81).", "url": PM + "30688979", "mission": "bp"},
             {"do": "Treat hearing loss, stay social", "why": "Lancet 2024: hearing loss and social isolation are two of the largest modifiable risk factors (7.0% and 4.6%).", "url": "https://doi.org/10.1016/S0140-6736(24)01296-0", "mission": "connect"},
             {"do": "Speed training with boosters", "why": "ACTIVE trial, 20 years: speed training with boosters → dementia HR 0.75.", "url": PM + "41669119", "mission": "speed"},
             {"do": "Walk daily", "why": "UK Biobank: 9,826 steps/day linked to 51% lower dementia risk (observational).", "url": PM + "36066874", "mission": "steps"}]},
        {"id": "parkinsons", "group": "live", "name": "Parkinson's disease", "icon": "🤲", "color": "#7C8CFF",
         "what": "Clumps of alpha-synuclein damage the brainstem, including the substantia nigra that makes dopamine for movement.",
         "varies": "It usually climbs upward: brainstem first, then memory areas, then the thinking cortex (Braak stages 1–6). Not everyone follows this order.",
         "source": ("Braak et al. 2003, Neurobiology of Aging: staging of Parkinson's brain pathology", PM + "12498954"),
         "stages": [
             {"label": "Stages 1–2", "when": "Before movement symptoms",
              "symptoms": "Loss of smell, constipation, acting out dreams.", "regions": _ids("brainstem")},
             {"label": "Stages 3–4", "when": "Movement symptoms begin",
              "symptoms": "Tremor, slowness, stiffness, as the substantia nigra (in the brainstem) loses dopamine cells.",
              "regions": _ids("amygdala", "Parahippocampal Gyrus, anterior")},
             {"label": "Stages 5–6", "when": "Later",
              "symptoms": "Thinking and memory changes may follow.",
              "regions": _ids("Frontal Pole", "Middle Frontal Gyrus", "Superior Frontal Gyrus", "Angular Gyrus", "Precentral Gyrus", "Postcentral Gyrus")},
         ],
         "home": [
             {"do": "High-intensity aerobic exercise", "why": "SPARX trial: 6 months of treadmill exercise at 80–85% max heart rate, motor score worsened 0.3 points vs 3.2 with usual care (P=.03).", "url": PM + "29228079", "mission": "steps"},
             {"do": "Track movement speed", "why": "Reflex and Trail Connect track your own movement and speed trends to share with your doctor.", "url": PM + "27697851", "game": "reaction"}]},
        {"id": "stroke", "group": "lower", "name": "Stroke", "icon": "⚡", "color": "#FF5A6E",
         "what": "A blocked or burst blood vessel starves part of the brain of oxygen. Which part depends on which artery.",
         "varies": "Sudden, not gradual. The most common artery, the middle cerebral artery, feeds the side of the brain: movement, touch and speech.",
         "source": ("INTERSTROKE, Lancet 2016: 26,919 people in 32 countries", PM + "27431356"),
         "stages": [
             {"label": "Middle cerebral artery", "when": "Minutes matter",
              "symptoms": "Face droop, arm weakness, slurred or lost speech, often on one side.",
              "regions": _ids("Insular Cortex", "Precentral Gyrus", "Postcentral Gyrus", "Inferior Frontal Gyrus", "Superior Temporal Gyrus",
                              "Supramarginal Gyrus", "Central Opercular Cortex", "putamen")},
         ],
         "home": [
             {"do": "Learn BE-FAST", "why": "Balance, Eyes, Face, Arm, Speech, Time. Adding Balance and Eyes cut missed strokes from 14.1% to 4.4%. Call 911 immediately.", "url": PM + "28082668"},
             {"do": "Control blood pressure", "why": "INTERSTROKE: high blood pressure accounted for 47.9% of stroke risk.", "url": PM + "27431356", "mission": "bp"},
             {"do": "Stay active", "why": "INTERSTROKE: regular physical activity was linked to lower stroke risk (OR 0.60).", "url": PM + "27431356", "mission": "steps"}]},
        {"id": "huntingtons", "group": "early", "name": "Huntington's disease", "icon": "🧬", "color": "#B388FF",
         "what": "An inherited disease that destroys the striatum (caudate and putamen), the brain's movement and planning hub.",
         "varies": "Shrinkage moves in a set order (Vonsattel grades 0–4): caudate first, then putamen, then wider areas.",
         "source": ("Vonsattel et al. 1985, J Neuropathol Exp Neurol: grading of Huntington's striatal damage", PM + "2932539"),
         "stages": [
             {"label": "Early", "when": "Subtle", "symptoms": "Mood changes, clumsiness, small involuntary movements.", "regions": _ids("caudate")},
             {"label": "Middle", "when": "", "symptoms": "Jerky movements (chorea), trouble planning.", "regions": _ids("putamen")},
             {"label": "Advanced", "when": "", "symptoms": "Problems walking, speaking and swallowing; dementia.", "regions": _ids("pallidum", "accumbens", "Frontal Pole", "Middle Frontal Gyrus")},
         ],
         "home": [
             {"do": "Genetic counseling", "why": "It is inherited (a gene test exists). No lifestyle change is proven to prevent or slow it, so we don't claim one.", "url": PM + "2932539"}]},
        {"id": "als", "group": "early", "name": "ALS (motor neurone disease)", "icon": "💪", "color": "#3DDC97",
         "what": "Motor nerve cells in the brain and spinal cord die, weakening muscles.",
         "varies": "TDP-43 pathology spreads in 4 stages: motor cortex → front of the brain → touch areas and striatum → memory areas.",
         "source": ("Brettschneider et al. 2013, Annals of Neurology: stages of pTDP-43 pathology in ALS", PM + "23686809"),
         "stages": [
             {"label": "Stage 1", "when": "", "symptoms": "Weakness in a hand, foot or speech muscles.", "regions": _ids("Precentral Gyrus", "Juxtapositional Lobule Cortex", "brainstem")},
             {"label": "Stage 2", "when": "", "symptoms": "Some people notice changes in planning or behavior.", "regions": _ids("Middle Frontal Gyrus")},
             {"label": "Stage 3", "when": "", "symptoms": "", "regions": _ids("Frontal Orbital Cortex", "Postcentral Gyrus", "caudate", "putamen")},
             {"label": "Stage 4", "when": "", "symptoms": "", "regions": _ids("hippocampus", "Temporal Pole", "Parahippocampal Gyrus, anterior")},
         ],
         "home": [
             {"do": "See a specialist early", "why": "There is no proven lifestyle prevention, so we don't claim one. Multidisciplinary ALS clinics help with breathing, nutrition and mobility.", "url": PM + "23686809"}]},
        {"id": "ftd", "group": "early", "name": "Frontotemporal dementia", "icon": "🎭", "color": "#F06292",
         "what": "The front and side (temporal) lobes shrink, changing personality, behavior or language, often before age 65.",
         "varies": "The behavioural type mostly hits frontal areas and the insula; the language types hit the temporal lobes.",
         "source": ("Rascovsky et al. 2011, Brain: diagnostic criteria for behavioural-variant FTD", PM + "21810890"),
         "stages": [
             {"label": "Typical pattern", "when": "", "symptoms": "Loss of empathy, impulsive behavior, apathy, or trouble finding and understanding words.",
              "regions": _ids("Frontal Pole", "Frontal Orbital Cortex", "Frontal Medial Cortex", "Cingulate Gyrus, anterior", "Insular Cortex", "Temporal Pole")},
         ],
         "home": [
             {"do": "Notice behavior changes early", "why": "Early changes are in personality, not memory, and are often mistaken for depression. No proven prevention exists.", "url": PM + "21810890"}]},
        {"id": "ms", "group": "live", "name": "Multiple sclerosis", "icon": "🔆", "color": "#4FC3F7",
         "what": "The immune system attacks the insulation (myelin) around nerves, leaving lesions in white matter.",
         "varies": "Lesions appear around the ventricles, near the cortex, in the brainstem and spinal cord. Most people start with relapses and recovery; some progress steadily.",
         "source": ("Thompson et al. 2018, Lancet Neurology: McDonald criteria for MS", PM + "29275977"),
         "stages": [
             {"label": "Typical lesion sites", "when": "", "symptoms": "Blurred vision, numbness, weakness, balance problems, fatigue.",
              "regions": _ids("ventricles", "brainstem", "thalamus")},
         ],
         "home": [
             {"do": "Stop smoking", "why": "In an MS cohort, each smoke-free year lowered the risk of reaching moderate disability (HR 0.96 per year).", "url": PM + "28402456", "mission": "smoke"}]},
    ]


DOCTOR = {
    "alzheimers": "Memory or thinking changes that affect daily life (getting lost, repeating questions, missing bills): see your doctor. Many causes are treatable.",
    "stroke": "Any BE-FAST sign, even if it goes away: call 911 right away and note the time. Minutes matter.",
    "parkinsons": "A new tremor at rest, slower movements, smaller handwriting, or acting out dreams: ask your doctor about a neurology referral.",
    "huntingtons": "If it runs in your family, talk to a genetic counselor before testing. New involuntary movements or mood changes: see a doctor.",
    "als": "Weakness that keeps spreading, muscle twitching with wasting, or slurred speech without another cause: see a neurologist soon.",
    "ftd": "Big personality changes, loss of empathy, or trouble with words, often before age 65: ask for a memory-clinic referral.",
    "ms": "Sudden blurred or painful vision, numbness, or weakness lasting more than a day: see a doctor promptly.",
}


def get(did: str) -> dict:
    return next(d for d in catalog() if d["id"] == did)
