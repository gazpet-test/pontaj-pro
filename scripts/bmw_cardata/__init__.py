"""Integrare BMW CarData (REST) pentru ERP: kilometraj zilnic + combustibil/autonomii/SoC, scriere append-only in Supabase.
Doar stdlib. Tokenurile si starea locala stau in C:/Users/Gazpet-Ai/.secrete (in afara repo-ului, nesincronizat).
Comenzi: python -B -m bmw_cardata login | refresh | setup | citeste | scrie | stare  (PYTHONPATH=scripts)."""
import sys
sys.dont_write_bytecode = True  # ajutor; procedura recomandata ramane python -B
__version__ = '0.1.0'
