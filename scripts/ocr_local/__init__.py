"""Pilot OCR local Ofertare: LightOnOCR-2-1B + MinerU2.5-Pro, comparare, reconciliere dupa arbitraj (docs/paw/PLAN_OCR_LOCAL_OFERTARE.md).
Adaptat din pipeline-ul Codex 0.1.0 (geometrie, garda v3, reguli de client). Fara apel cloud si fara scriere in BD din acest pachet."""
import sys
sys.dont_write_bytecode = True  # ajutor, nu garantie: __init__ poate fi deja in cache - procedura OBLIGATORIE e python -B
__version__ = '0.2.0'
