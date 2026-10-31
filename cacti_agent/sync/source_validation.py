"""Validate bulk source rows without importing repository-only pilot config."""
from compare_devices import FIELDS, planned_description, validate_customer
from sync_headers import normalize


def validate_source(manifest, source):
    aliases = {row['alias']: row['name'] for row in source.get('aliases', [])}
    for row in manifest:
        matches = [item for item in source['customers'] if item['sid'] == row['sid'] and normalize(item.get('server')) == row['server']]
        if len(matches) != 1 or any(item['sid'] == row['sid'] for item in source.get('conflicts', [])):
            raise RuntimeError('SID batch tidak tersedia unik pada sumber terbaru.')
        item = matches[0]
        name = normalize(item['customer_name'])
        if (validate_customer(item) or (aliases.get(name) or name) != row['institution']
                or planned_description(item) != row['description']
                or any(str(item[key]) != row['desired'][key] for key in FIELDS)):
            raise RuntimeError('Sumber berubah dari manifest yang disetujui.')
