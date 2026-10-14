"""Pilot OCR local Ofertare: LightOnOCR-2-1B + MinerU2.5-Pro, comparare, reconciliere dupa arbitraj (docs/paw/PLAN_OCR_LOCAL_OFERTARE.md).
Adaptat din pipeline-ul Codex 0.1.0 (geometrie, garda v3, reguli de client). Fara apel cloud si fara scriere in BD din acest pachet."""
import sys
sys.dont_write_bytecode = True  # modulele urmatoare nu lasa __pycache__ langa cod (rulati si cu python -B pentru __init__)
__version__ = '0.2.0'
