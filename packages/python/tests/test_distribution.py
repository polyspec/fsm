"""The distribution name of the python package (S-406). Every polyspec wheel names its product and its part, as polyspec-orm,
polyspec-template and polyspec-crudui-validator do, and the runtime belongs to the release label (P39), not to the name. The first
release fixes the name, so the distribution of this package is polyspec-fsm.
"""

import tomllib
import unittest
from pathlib import Path

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


class DistributionName(unittest.TestCase):
    def test_distribution_is_polyspec_fsm(self):
        with PYPROJECT.open("rb") as file:
            name = tomllib.load(file)["project"]["name"]
        self.assertEqual(name, "polyspec-fsm")


if __name__ == "__main__":
    unittest.main()
