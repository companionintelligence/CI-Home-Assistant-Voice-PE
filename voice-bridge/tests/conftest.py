"""conftest.py – add the voice-bridge parent directory to sys.path."""
import sys
import os

# Allow "from voice_bridge.src.xxx import ..." style imports
# by pointing Python at the directory containing 'voice-bridge'
# We use the directory containing main.py as a base
BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(BRIDGE_DIR)

# voice-bridge dir is a package named via its __init__.py; add its parent
# to sys.path so "import voice_bridge" would work if we named things correctly.
# Instead, add voice-bridge itself so "from src.xxx import ..." works.
if BRIDGE_DIR not in sys.path:
    sys.path.insert(0, BRIDGE_DIR)
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)
