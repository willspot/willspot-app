-- Help centre FAQ as a third admin-editable config document (ADR-033).
ALTER TABLE config_docs DROP CONSTRAINT config_docs_key_check;
ALTER TABLE config_docs ADD CONSTRAINT config_docs_key_check CHECK (key IN ('brand', 'flags', 'faq'));
