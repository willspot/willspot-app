-- Phase 3: real bank partner support
ALTER TABLE virtual_accounts ADD COLUMN provider_customer_ref text;
CREATE INDEX virtual_accounts_customer_ref ON virtual_accounts(provider_customer_ref);
