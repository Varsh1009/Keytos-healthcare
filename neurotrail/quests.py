"""
The quest catalog: concrete action steps, weighted by evidence.

Every number was checked against its primary source on 2026-11-11 (Lancet
Table 1 read on thelancet.com; trial results from PubMed abstracts; home BP
steps from the American Heart Association; quitline from CDC).
"Our data" numbers are read live from the NHANES models.

Sparks (points) are proportional to evidence:
    sparks = 20 + tier_bonus + round(5 x Lancet weighted PAF %)
    tier_bonus: randomized trial = 30, large cohort = 15, mixed/weak = 5
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

TIER_BONUS = {"Randomized trial": 30, "Large cohort": 15, "Mixed / weak": 5}
LANCET_URL = "https://doi.org/10.1016/S0140-6736(24)01296-0"
LANCET_CITE = ("Livingston G et al. Dementia prevention, intervention, and care: 2024 report of the "
               "Lancet standing Commission. Lancet 2024. Table 1.")


@dataclass
class Quest:
    id: str
    title: str
    stop: str                 # landmark name on the trail
    icon: str
    color: str                # glow color for its brain region
    regions: list[str]        # Destrieux labels (all visible on the cortical surface)
    region_name: str
    region_fact: str          # true statement about the region; no causal claim
    steps: list[str]          # concrete action checklist
    log: dict                 # what gets measured, e.g. {"kind": "bp"}
    tier: str
    lancet_paf: float | None
    evidence: list[dict] = field(default_factory=list)   # {"claim", "url"}
    nhanes_key: str | None = None
    caveat: str = ""
    smokers_only: bool = False

    @property
    def sparks(self) -> int:
        return 20 + TIER_BONUS[self.tier] + round(5 * (self.lancet_paf or 0))

    def to_dict(self) -> dict:
        d = asdict(self)
        d["sparks"] = self.sparks
        return d


QUESTS: list[Quest] = [
    Quest(
        id="speed", title="Speed Sprint", stop="Prefrontal Peak", icon="⚡", color="#FFC83D",
        regions=["G_front_middle", "S_front_middle", "S_front_sup"],
        region_name="Dorsolateral prefrontal cortex",
        region_fact="The middle frontal gyrus supports working memory and attention, abilities a "
                    "symbol-matching speed task draws on.",
        steps=["Find a quiet spot with no distractions",
               "Play one 90-second Speed Sprint round",
               "Booster: play a second round and try to beat your first score"],
        log={"kind": "speed"}, tier="Randomized trial", lancet_paf=None,
        evidence=[{"claim": "ACTIVE trial, 20-year Medicare follow-up (n=2,021): speed training with ≥1 "
                            "booster session → lower diagnosed dementia, HR 0.75 (95% CI 0.59–0.95). "
                            "Without boosters: HR 1.01. Memory and reasoning training: no effect.",
                   "url": "https://pubmed.ncbi.nlm.nih.gov/41669119/"}],
        caveat="Only speed training *with boosters* was linked to benefit, hence the second round. "
               "The game is our own digital version, not the trial software.",
    ),
    Quest(
        id="bp", title="Pressure Point", stop="Cingulate Crossing", icon="🩺", color="#FF5A6E",
        regions=["G_and_S_cingul-Ant", "G_and_S_cingul-Mid-Ant"],
        region_name="Anterior cingulate cortex",
        region_fact="The anterior cingulate helps regulate the body's autonomic responses, "
                    "including heart rate and blood pressure.",
        steps=["No smoking, caffeine or exercise for 30 minutes beforehand",
               "Sit with back supported, arm resting at heart level, cuff on bare upper arm",
               "Rest quietly for at least 5 minutes (no talking, no phone)",
               "Take two readings one minute apart and log both"],
        log={"kind": "bp"}, tier="Randomized trial", lancet_paf=2.2, nhanes_key="sbp",
        evidence=[{"claim": "SPRINT MIND RCT (n=9,361): intensive BP control (<120 mmHg) reduced mild "
                            "cognitive impairment, HR 0.81 (0.69–0.95), and MCI-or-dementia, HR 0.85 "
                            "(0.74–0.97). Dementia alone: HR 0.83 (0.67–1.04), not significant.",
                   "url": "https://pubmed.ncbi.nlm.nih.gov/30688979/"},
                  {"claim": "Measurement steps from the American Heart Association home-monitoring guide.",
                   "url": "https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home"},
                  {"claim": "Lancet 2024: hypertension RR 1.2, weighted PAF 2.2%.", "url": LANCET_URL}],
        caveat="Measuring doesn't lower BP. Treatment targets are a decision for you and your clinician.",
    ),
    Quest(
        id="steps", title="Step Street", stop="Motor Mile", icon="👟", color="#3DDC97",
        regions=["G_precentral", "S_precentral-sup-part", "S_precentral-inf-part", "G_and_S_paracentral"],
        region_name="Primary motor cortex",
        region_fact="The precentral gyrus is the primary motor cortex: it sends the commands that "
                    "move your legs.",
        steps=["Pick today's target: 3,826 steps (minimum dose) or 9,826 (optimal dose)",
               "Include at least one brisk 10-minute stretch",
               "Log today's step count from your phone or watch"],
        log={"kind": "steps"}, tier="Large cohort", lancet_paf=2.4, nhanes_key="active_min_week",
        evidence=[{"claim": "UK Biobank accelerometers (n=78,430, 6.9 yr): 9,826 steps/day → dementia HR "
                            "0.49 (0.39–0.62); 3,826 steps/day → HR 0.75 (0.67–0.83). Observational.",
                   "url": "https://pubmed.ncbi.nlm.nih.gov/36066874/"},
                  {"claim": "STEP UP RCT (n=602): gamified competition added +920 steps/day (513–1,328) and "
                            "was the only arm still higher after the game ended.",
                   "url": "https://pubmed.ncbi.nlm.nih.gov/31498375/"},
                  {"claim": "Lancet 2024: physical inactivity RR 1.2, weighted PAF 2.4%.", "url": LANCET_URL}],
        caveat="In our NHANES model, *self-reported* activity minutes showed no association with "
               "processing speed. Device-measured steps (UK Biobank) did. We show both.",
    ),
    Quest(
        id="connect", title="Connection Call", stop="Social Junction", icon="💬", color="#4FC3F7",
        regions=["G_pariet_inf-Supramar", "G_pariet_inf-Angular"],
        region_name="Temporoparietal junction",
        region_fact="The temporoparietal junction helps you understand other people's thoughts and "
                    "perspectives.",
        steps=["Choose one person you care about",
               "Have a 10+ minute voice call, video call or visit (texting doesn't count)",
               "Log who you talked to and for how long"],
        log={"kind": "connect"}, tier="Large cohort", lancet_paf=4.6,
        evidence=[{"claim": "Lancet 2024: social isolation RR 1.6, weighted PAF 4.6%, among the largest "
                            "late-life factors.", "url": LANCET_URL},
                  {"claim": "US POINTER RCT (n=2,111): the structured arm (with social engagement and 38 "
                            "team meetings) improved global cognition more than self-guided, +0.029 SD/yr "
                            "(0.008–0.050).", "url": "https://pubmed.ncbi.nlm.nih.gov/40720610/"}],
    ),
    Quest(
        id="hearing", title="Sound Check", stop="Auditory Avenue", icon="👂", color="#B388FF",
        regions=["G_temp_sup-Lateral", "G_temp_sup-G_T_transv", "G_temp_sup-Plan_tempo",
                 "S_temporal_transverse"],
        region_name="Superior temporal gyrus (auditory cortex)",
        region_fact="The superior temporal gyrus contains the auditory cortex, where sound is "
                    "first processed in the cortex.",
        steps=["If you wear hearing aids: wear them all waking hours today",
               "If you don't: take a hearing screening (clinic, pharmacy or validated app)",
               "If the screen flags loss: book a full test with an audiologist"],
        log={"kind": "hearing"}, tier="Mixed / weak", lancet_paf=7.0, nhanes_key="hearing_trouble",
        evidence=[{"claim": "Lancet 2024: hearing loss RR 1.4, weighted PAF 7.0%, tied for largest factor.",
                   "url": LANCET_URL},
                  {"claim": "ACHIEVE RCT: hearing aids had no effect on 3-year cognition overall (−0.002, "
                            "95% CI −0.08 to 0.08); in the higher-risk ARIC subgroup, 48% less decline.",
                   "url": LANCET_URL}],
        caveat="Rated Mixed because the big trial was null overall. In our NHANES 2011-12 model, "
               "self-reported hearing trouble was not associated with processing speed.",
    ),
    Quest(
        id="joy", title="Joy Plan", stop="Reward Ridge", icon="🎯", color="#FF9F43",
        regions=["G_orbital", "G_rectus", "S_orbital-H_Shaped", "S_orbital_lateral"],
        region_name="Orbitofrontal cortex",
        region_fact="The orbitofrontal cortex is involved in reward and in regulating emotion.",
        steps=["Pick one activity that gives you pleasure or a sense of achievement",
               "Schedule it: choose an exact time today",
               "Do it for at least 15 minutes",
               "Rate your mood before and after (0–10)"],
        log={"kind": "joy", "menu": ["Walk outside", "Cook something new", "Play or listen to music",
                                     "Garden or tidy one space", "Finish a task you've put off",
                                     "Creative hobby", "Help someone"]},
        tier="Randomized trial", lancet_paf=3.0, nhanes_key="phq9",
        evidence=[{"claim": "Behavioural activation, which this quest follows (plan and do rewarding "
                            "activities): meta-analysis of 26 RCTs (n=1,524) found it beat controls for "
                            "depressive symptoms, SMD −0.74 (−0.91 to −0.56). Study quality was mostly low.",
                   "url": "https://pubmed.ncbi.nlm.nih.gov/24936656/"},
                  {"claim": "Lancet 2024: depression RR 2.2, weighted PAF 3.0%.", "url": LANCET_URL}],
        caveat="A self-help step, not treatment. If you're struggling, call or text 988 (US).",
    ),
    Quest(
        id="smoke", title="Smoke-Free Day", stop="Stop-Signal Summit", icon="🚭", color="#26C6DA",
        regions=["G_front_inf-Opercular", "G_front_inf-Triangul", "S_front_inf"],
        region_name="Inferior frontal gyrus",
        region_fact="The inferior frontal gyrus supports response inhibition: stopping an action "
                    "once it's started.",
        steps=["Write down today's biggest smoking trigger",
               "Plan a substitute for that moment (walk, water, gum)",
               "Stay smoke-free today",
               "Optional: call 1-800-QUIT-NOW for free coaching"],
        log={"kind": "check"}, tier="Large cohort", lancet_paf=2.3, nhanes_key="current_smoker",
        evidence=[{"claim": "Lancet 2024: smoking RR 1.3, weighted PAF 2.3%. Whitehall II: current smokers "
                            "HR 1.36 (1.10–1.68); ex-smokers no increased risk.", "url": LANCET_URL},
                  {"claim": "Free US quitline 1-800-QUIT-NOW (CDC).",
                   "url": "https://www.cdc.gov/tobacco/campaign/tips/quit-smoking/quitline/index.html"}],
        smokers_only=True,
    ),
    Quest(
        id="sleep", title="Sleep Station", stop="Memory Meadow", icon="🌙", color="#7C8CFF",
        regions=["G_oc-temp_med-Parahip", "Pole_temporal", "G_temporal_inf"],
        region_name="Medial and inferior temporal lobe",
        region_fact="The parahippocampal gyrus is part of the medial temporal memory system.",
        steps=["Keep the same wake-up time as yesterday",
               "Screens off 30 minutes before bed",
               "Log last night's hours of sleep"],
        log={"kind": "sleep"}, tier="Mixed / weak", lancet_paf=None, nhanes_key="sleep_hours",
        evidence=[{"claim": "Lancet 2024 did NOT include sleep as a modifiable dementia risk factor: "
                            "evidence was inconsistent and prone to reverse causation.", "url": LANCET_URL}],
        caveat="Low sparks on purpose because the evidence is weaker. Our NHANES model did find shorter "
               "sleep associated with slower processing speed.",
    ),
    Quest(
        id="labs", title="Know Your Numbers", stop="Metabolic Mesa", icon="🧪", color="#F06292",
        regions=["G_precuneus", "G_cingul-Post-dorsal", "G_cingul-Post-ventral"],
        region_name="Precuneus and posterior cingulate",
        region_fact="The posterior cingulate and precuneus are hubs of the default-mode network, "
                    "among the brain's most metabolically active regions.",
        steps=["Find your latest LDL cholesterol and HbA1c in your patient portal",
               "If either is older than 12 months, book a check",
               "Log the values (optional)"],
        log={"kind": "labs"}, tier="Large cohort", lancet_paf=6.9, nhanes_key="diabetes",
        evidence=[{"claim": "Lancet 2024: high LDL cholesterol RR 1.3, weighted PAF 6.9%; diabetes RR 1.7, "
                            "weighted PAF 2.3%.", "url": LANCET_URL}],
    ),
]
QUEST_BY_ID = {q.id: q for q in QUESTS}
