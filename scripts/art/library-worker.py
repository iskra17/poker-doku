"""Entrypoint for the independent, local Poker Doku general-art queue."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from library.cli import entry

if __name__=='__main__': sys.exit(entry())
