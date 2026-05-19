---
name: odoo-model-parity
description: Prevent and debug Odoo missing-field crashes caused by alternate/public/portal/read-safe models. Use when adding Odoo model fields, seeing Missing field errors, debugging non-admin/public/portal/kiosk/mobile/OCR flows, or touching hr.employee/public models and similar model pairs.
---

# Odoo Model Parity

Use this skill for Odoo bugs where a field exists on one model but a flow reads a related alternate model, causing non-admin users to crash with missing fields. Common triggers include Expenses/OCR receipt scanning, kiosk/mobile flows, portal/public pages, and users without HR/admin permissions.

## Core concept

Odoo frequently exposes alternate/read-safe models depending on permissions or channel. Custom fields added to a private/full model may also need to exist on its public/portal/proxy counterpart if shared UI, JS, controllers, views, or `read/search_read` flows can request those fields.

Known parity contract:

- `hr.employee` -> `hr.employee.public`
  - Non-HR users often read employees through `hr.employee.public`.
  - Missing mirrored field definitions can crash unrelated flows such as Expenses/OCR receipt scanning.

This is a general pattern. When you discover another pair, document it in the project and add it to tests/checks.

## Investigation checklist

1. Identify the failing model and field from the traceback/browser/Odoo log.
2. Identify the affected user type: admin, internal non-HR, portal, public, kiosk, mobile, OCR/IAP flow.
3. Search for alternate model families:
   - `*.public`
   - `*.portal`
   - `public`/`portal` controllers
   - SQL view/proxy/read-only models
   - frontend JS `read`, `searchRead`, `orm.read`, `web_search_read`
4. Compare fields between the full/source model and alternate/target model.
5. If the field can be requested in the target flow, choose one fix:
   - Mirror the field definition on the alternate model with matching type/relation and safe groups.
   - Stop requesting the field in that flow.
   - Guard the read with `if field in model._fields` only when optional behavior is acceptable.
6. Add/extend a regression test for the parity contract.
7. Test as the affected non-admin user, not only as admin.
8. For installable Odoo modules, bump the module version when fields/schema are added.

## Preferred test pattern

Create a reusable parity test with explicit contracts. Example:

```python
# -*- coding: utf-8 -*-

from odoo.tests.common import TransactionCase


class TestModelFieldParity(TransactionCase):
    FIELD_PARITY_CONTRACTS = [
        {
            'source': 'hr.employee',
            'target': 'hr.employee.public',
            'fields': [
                'custom_field_name',
            ],
            'reason': 'Non-HR users read employees through hr.employee.public.',
        },
    ]

    def test_declared_model_field_parity_contracts(self):
        for contract in self.FIELD_PARITY_CONTRACTS:
            source = self.env[contract['source']]
            target = self.env[contract['target']]
            fields = contract['fields']
            with self.subTest(source=contract['source'], target=contract['target']):
                self.assertFalse([f for f in fields if f not in source._fields])
                self.assertFalse(
                    [f for f in fields if f not in target._fields],
                    f"Missing fields on {contract['target']} for parity with "
                    f"{contract['source']} ({contract.get('reason', '')})",
                )
```

Prefer explicit contracts over blindly requiring every source field on every target model; some fields are intentionally private.

## Direct Odoo shell verification

```python
missing = [f for f in [
    'field_a',
    'field_b',
] if f not in env['target.model']._fields]
missing
```

Expected after the fix:

```python
[]
```

To simulate the affected user:

```python
user = env['res.users'].search([('login', '=', 'USER_LOGIN')], limit=1)
record = env['target.model'].with_user(user).search([], limit=1)
record.read(['name', 'field_a', 'field_b'])
```

## Static scan helper idea

When working in a repository, a quick AST/static scan can find fields declared on `hr.employee` but not on `hr.employee.public`. Keep the result advisory: it identifies candidates for explicit parity contracts, not automatic requirements.

## Common fix for `hr.employee` -> `hr.employee.public`

If a module adds a field to `hr.employee` that can be read by non-HR users, add the same field name/type to the module's `hr.employee.public` extension and import that model file in `models/__init__.py`.

Use safe groups on the public field. Match the source field's security intent where possible.
