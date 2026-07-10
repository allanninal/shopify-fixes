# Dummy environment so the scripts import cleanly during tests.
# The tests only exercise pure functions, so no real credentials are ever used.
import os

os.environ.setdefault("SHOPIFY_SHOP", "example.myshopify.com")
os.environ.setdefault("SHOPIFY_ACCESS_TOKEN", "shpat_dummy")
