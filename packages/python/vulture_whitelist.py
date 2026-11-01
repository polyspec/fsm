"""The names of the python package that vulture cannot see in use: unittest finds the test classes by discovery (S-406)."""

from tests.test_distribution import DistributionName

DistributionName  # the test class of the distribution name, run by unittest discovery
