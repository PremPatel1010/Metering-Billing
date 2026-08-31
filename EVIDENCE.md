## Requirement: Idempotent Metering

**Proof:** Same request sent twice with idempotency_key "test-key-1"

First request (201 Created):
{"message":"Usage Event Created","event":{"id":2,...}}

Second request (200 OK - same event returned):
{"message":"Usage Event Already Recorded","event":{"id":2,...}}

Database confirms only ONE row exists for this idempotency_key.