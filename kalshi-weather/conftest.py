"""Root conftest -- ensure pavlov package is importable for tests.

The root __init__.py has relative imports from a legacy layout that fail
when pytest tries to import it as a package.  We pre-load a dummy module
under the root package name so Python never actually executes that file.
"""

import sys
import types
from pathlib import Path

_root = Path(__file__).resolve().parent

# Inject a dummy module so the broken root __init__.py is never imported.
_pkg_name = _root.name  # "kalshi-weather" -- not a valid Python identifier anyway
# The real issue: pytest treats the root dir as an unnamed package and tries
# to import __init__.py.  We block that by pre-registering the root dir's
# __init__ in sys.modules.
_root_init_key = "__init__"
if _root_init_key not in sys.modules:
    sys.modules[_root_init_key] = types.ModuleType(_root_init_key)

# Make sure the project root is on sys.path so `import pavlov` works.
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

# Tell pytest to skip collecting the root __init__.py
collect_ignore = [
    str(_root / "__init__.py"),
    str(_root / "kelly_sizer.py"),
    str(_root / "weather_predictor.py"),
]
