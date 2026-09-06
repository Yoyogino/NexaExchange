--
-- PostgreSQL database dump
--

\restrict feCZgq3T63upytyxcDjxjrDgoBK8lkTM4Tyq5Uzi4BHvYe4yTLQ5IvjlBKggCyy

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: Asset; Type: TYPE; Schema: public; Owner: exchange
--

CREATE TYPE public."Asset" AS ENUM (
    'BTC',
    'USDT'
);


ALTER TYPE public."Asset" OWNER TO exchange;

--
-- Name: LedgerAccountType; Type: TYPE; Schema: public; Owner: exchange
--

CREATE TYPE public."LedgerAccountType" AS ENUM (
    'AVAILABLE',
    'LOCKED',
    'SYSTEM_ISSUANCE',
    'FEE'
);


ALTER TYPE public."LedgerAccountType" OWNER TO exchange;

--
-- Name: LedgerDirection; Type: TYPE; Schema: public; Owner: exchange
--

CREATE TYPE public."LedgerDirection" AS ENUM (
    'DEBIT',
    'CREDIT'
);


ALTER TYPE public."LedgerDirection" OWNER TO exchange;

--
-- Name: OrderSide; Type: TYPE; Schema: public; Owner: exchange
--

CREATE TYPE public."OrderSide" AS ENUM (
    'BUY',
    'SELL'
);


ALTER TYPE public."OrderSide" OWNER TO exchange;

--
-- Name: OrderStatus; Type: TYPE; Schema: public; Owner: exchange
--

CREATE TYPE public."OrderStatus" AS ENUM (
    'PENDING',
    'PARTIALLY_FILLED',
    'FILLED',
    'CANCELLED',
    'OPEN'
);


ALTER TYPE public."OrderStatus" OWNER TO exchange;

--
-- Name: OrderType; Type: TYPE; Schema: public; Owner: exchange
--

CREATE TYPE public."OrderType" AS ENUM (
    'LIMIT',
    'MARKET'
);


ALTER TYPE public."OrderType" OWNER TO exchange;

--
-- Name: UserRole; Type: TYPE; Schema: public; Owner: exchange
--

CREATE TYPE public."UserRole" AS ENUM (
    'TRADER',
    'ADMIN'
);


ALTER TYPE public."UserRole" OWNER TO exchange;

--
-- Name: insert_sessions_view(); Type: FUNCTION; Schema: public; Owner: exchange
--

CREATE FUNCTION public.insert_sessions_view() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "Session" (
    id, "userId", "tokenHash", "expiresAt", "previousTokenHash", 
    "previousTokenExpiresAt", "ipAddress", "userAgent", "revokedAt", "lastSeenAt", "rotatedAt"
  )
  VALUES (
    COALESCE(NEW.id, gen_random_uuid()::text),
    NEW.user_id,
    NEW.token_hash,
    NEW.expires_at,
    NEW.previous_token_hash,
    NEW.previous_token_expires_at,
    NEW.ip_address,
    NEW.user_agent,
    NEW.revoked_at,
    COALESCE(NEW.last_seen_at, CURRENT_TIMESTAMP),
    NEW.rotated_at
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.insert_sessions_view() OWNER TO exchange;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AuditEvent; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public."AuditEvent" (
    id text NOT NULL,
    "actorUserId" text,
    action text NOT NULL,
    "targetType" text,
    "targetId" text,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AuditEvent" OWNER TO exchange;

--
-- Name: LedgerAccount; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public."LedgerAccount" (
    id text NOT NULL,
    "userId" text,
    asset public."Asset" NOT NULL,
    "accountType" public."LedgerAccountType" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."LedgerAccount" OWNER TO exchange;

--
-- Name: LedgerEntry; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public."LedgerEntry" (
    id text NOT NULL,
    "groupId" text NOT NULL,
    "ledgerAccountId" text NOT NULL,
    direction public."LedgerDirection" NOT NULL,
    amount numeric(28,8) NOT NULL,
    reason text NOT NULL,
    "relatedType" text,
    "relatedId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."LedgerEntry" OWNER TO exchange;

--
-- Name: Market; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public."Market" (
    id text NOT NULL,
    "baseCurrency" text NOT NULL,
    "quoteCurrency" text NOT NULL,
    symbol text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Market" OWNER TO exchange;

--
-- Name: Order; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public."Order" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "marketId" text NOT NULL,
    side public."OrderSide" NOT NULL,
    type public."OrderType" NOT NULL,
    price numeric(28,8),
    quantity numeric(28,8) NOT NULL,
    "filledAmount" numeric(28,8) DEFAULT 0 NOT NULL,
    status public."OrderStatus" DEFAULT 'PENDING'::public."OrderStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Order" OWNER TO exchange;

--
-- Name: Session; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public."Session" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "tokenHash" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "previousTokenExpiresAt" timestamp(3) without time zone,
    "previousTokenHash" text,
    "ipAddress" text,
    "userAgent" text,
    "revokedAt" timestamp(3) without time zone,
    "lastSeenAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" timestamp(3) without time zone
);


ALTER TABLE public."Session" OWNER TO exchange;

--
-- Name: Trade; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public."Trade" (
    id text NOT NULL,
    "orderId" text NOT NULL,
    "marketId" text NOT NULL,
    "counterOrderId" text,
    price numeric(28,8) NOT NULL,
    quantity numeric(28,8) NOT NULL,
    fee numeric(28,8) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Trade" OWNER TO exchange;

--
-- Name: User; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    role public."UserRole" DEFAULT 'TRADER'::public."UserRole" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "twoFactorSecret" text,
    two_factor_secret text,
    password_hash text,
    demo_grant_claimed boolean DEFAULT true,
    trading_disabled boolean DEFAULT false,
    email_verified boolean DEFAULT true,
    two_factor_enabled boolean DEFAULT false
);


ALTER TABLE public."User" OWNER TO exchange;

--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public.audit_events (
    id text NOT NULL,
    actor_user_id text,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.audit_events OWNER TO exchange;

--
-- Name: email_verification_tokens; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public.email_verification_tokens (
    id text NOT NULL,
    user_id text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.email_verification_tokens OWNER TO exchange;

--
-- Name: ledger_accounts; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public.ledger_accounts (
    id uuid NOT NULL,
    user_id text,
    asset public."Asset" NOT NULL,
    account_type public."LedgerAccountType" NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.ledger_accounts OWNER TO exchange;

--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public.ledger_entries (
    id text NOT NULL,
    group_id text NOT NULL,
    ledger_account_id uuid NOT NULL,
    direction text NOT NULL,
    amount numeric(28,8) NOT NULL,
    reason text NOT NULL,
    related_type text,
    related_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.ledger_entries OWNER TO exchange;

--
-- Name: login_history; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public.login_history (
    id text NOT NULL,
    user_id text,
    succeeded boolean NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.login_history OWNER TO exchange;

--
-- Name: markets; Type: VIEW; Schema: public; Owner: exchange
--

CREATE VIEW public.markets AS
 SELECT id,
    "baseCurrency" AS base_currency,
    "quoteCurrency" AS quote_currency,
    symbol,
    "isActive" AS is_active,
        CASE
            WHEN "isActive" THEN 'ACTIVE'::text
            ELSE 'INACTIVE'::text
        END AS status,
    "createdAt" AS created_at,
    "updatedAt" AS updated_at
   FROM public."Market";


ALTER VIEW public.markets OWNER TO exchange;

--
-- Name: order_requests; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public.order_requests (
    id text NOT NULL,
    user_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.order_requests OWNER TO exchange;

--
-- Name: orders; Type: VIEW; Schema: public; Owner: exchange
--

CREATE VIEW public.orders AS
 SELECT o.id,
    o."userId" AS user_id,
    o."marketId" AS market_id,
    m.symbol,
    o.side,
    o.type,
    o.status,
    o.price,
    o.quantity,
    o."filledAmount" AS filled_amount,
    o."filledAmount" AS filled_quantity,
    (o.quantity - o."filledAmount") AS remaining_quantity,
    o."createdAt" AS created_at,
    o."updatedAt" AS updated_at
   FROM (public."Order" o
     LEFT JOIN public."Market" m ON ((o."marketId" = m.id)));


ALTER VIEW public.orders OWNER TO exchange;

--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: exchange
--

CREATE TABLE public.password_reset_tokens (
    id text NOT NULL,
    user_id text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.password_reset_tokens OWNER TO exchange;

--
-- Name: sessions; Type: VIEW; Schema: public; Owner: exchange
--

CREATE VIEW public.sessions AS
 SELECT id,
    "userId",
    "tokenHash",
    "expiresAt",
    "createdAt",
    "previousTokenExpiresAt",
    "previousTokenHash",
    "ipAddress",
    "userAgent",
    "revokedAt",
    "lastSeenAt",
    "rotatedAt",
    "userId" AS user_id,
    "tokenHash" AS token_hash,
    "expiresAt" AS expires_at,
    "previousTokenHash" AS previous_token_hash,
    "previousTokenExpiresAt" AS previous_token_expires_at,
    "ipAddress" AS ip_address,
    "userAgent" AS user_agent,
    "revokedAt" AS revoked_at,
    "lastSeenAt" AS last_seen_at,
    "rotatedAt" AS rotated_at,
    "createdAt" AS created_at
   FROM public."Session";


ALTER VIEW public.sessions OWNER TO exchange;

--
-- Name: trades; Type: VIEW; Schema: public; Owner: exchange
--

CREATE VIEW public.trades AS
 SELECT id,
    "marketId" AS market_id,
    "orderId" AS buy_order_id,
    "counterOrderId" AS sell_order_id,
    price,
    quantity,
    fee AS buyer_fee,
    fee AS seller_fee,
    "createdAt" AS created_at
   FROM public."Trade";


ALTER VIEW public.trades OWNER TO exchange;

--
-- Name: users; Type: VIEW; Schema: public; Owner: exchange
--

CREATE VIEW public.users AS
 SELECT id,
    email,
    role,
    password_hash,
    demo_grant_claimed,
    trading_disabled,
    email_verified,
    two_factor_enabled,
    "twoFactorSecret" AS two_factor_secret,
    "createdAt" AS created_at,
    "updatedAt" AS updated_at
   FROM public."User";


ALTER VIEW public.users OWNER TO exchange;

--
-- Name: AuditEvent AuditEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."AuditEvent"
    ADD CONSTRAINT "AuditEvent_pkey" PRIMARY KEY (id);


--
-- Name: LedgerAccount LedgerAccount_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."LedgerAccount"
    ADD CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY (id);


--
-- Name: LedgerEntry LedgerEntry_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."LedgerEntry"
    ADD CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY (id);


--
-- Name: Market Market_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."Market"
    ADD CONSTRAINT "Market_pkey" PRIMARY KEY (id);


--
-- Name: Order Order_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."Order"
    ADD CONSTRAINT "Order_pkey" PRIMARY KEY (id);


--
-- Name: Session Session_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY (id);


--
-- Name: Trade Trade_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."Trade"
    ADD CONSTRAINT "Trade_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: email_verification_tokens email_verification_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_pkey PRIMARY KEY (id);


--
-- Name: ledger_accounts ledger_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.ledger_accounts
    ADD CONSTRAINT ledger_accounts_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: login_history login_history_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.login_history
    ADD CONSTRAINT login_history_pkey PRIMARY KEY (id);


--
-- Name: order_requests order_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.order_requests
    ADD CONSTRAINT order_requests_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: LedgerAccount_userId_asset_accountType_key; Type: INDEX; Schema: public; Owner: exchange
--

CREATE UNIQUE INDEX "LedgerAccount_userId_asset_accountType_key" ON public."LedgerAccount" USING btree ("userId", asset, "accountType");


--
-- Name: LedgerEntry_groupId_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE INDEX "LedgerEntry_groupId_idx" ON public."LedgerEntry" USING btree ("groupId");


--
-- Name: LedgerEntry_ledgerAccountId_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE INDEX "LedgerEntry_ledgerAccountId_idx" ON public."LedgerEntry" USING btree ("ledgerAccountId");


--
-- Name: Market_isActive_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE INDEX "Market_isActive_idx" ON public."Market" USING btree ("isActive");


--
-- Name: Market_symbol_key; Type: INDEX; Schema: public; Owner: exchange
--

CREATE UNIQUE INDEX "Market_symbol_key" ON public."Market" USING btree (symbol);


--
-- Name: Order_createdAt_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE INDEX "Order_createdAt_idx" ON public."Order" USING btree ("createdAt");


--
-- Name: Order_marketId_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE INDEX "Order_marketId_idx" ON public."Order" USING btree ("marketId");


--
-- Name: Order_status_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE INDEX "Order_status_idx" ON public."Order" USING btree (status);


--
-- Name: Order_userId_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE INDEX "Order_userId_idx" ON public."Order" USING btree ("userId");


--
-- Name: Trade_createdAt_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE INDEX "Trade_createdAt_idx" ON public."Trade" USING btree ("createdAt");


--
-- Name: Trade_marketId_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE INDEX "Trade_marketId_idx" ON public."Trade" USING btree ("marketId");


--
-- Name: Trade_orderId_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE INDEX "Trade_orderId_idx" ON public."Trade" USING btree ("orderId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: exchange
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: ledger_accounts_asset_type_null_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE UNIQUE INDEX ledger_accounts_asset_type_null_idx ON public."LedgerAccount" USING btree (asset, "accountType") WHERE ("userId" IS NULL);


--
-- Name: ledger_accounts_asset_type_null_user_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE UNIQUE INDEX ledger_accounts_asset_type_null_user_idx ON public.ledger_accounts USING btree (asset, account_type) WHERE (user_id IS NULL);


--
-- Name: ledger_accounts_user_asset_type_nonnull_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE UNIQUE INDEX ledger_accounts_user_asset_type_nonnull_idx ON public."LedgerAccount" USING btree ("userId", asset, "accountType") WHERE ("userId" IS NOT NULL);


--
-- Name: ledger_accounts_user_asset_type_not_null_idx; Type: INDEX; Schema: public; Owner: exchange
--

CREATE UNIQUE INDEX ledger_accounts_user_asset_type_not_null_idx ON public.ledger_accounts USING btree (user_id, asset, account_type) WHERE (user_id IS NOT NULL);


--
-- Name: sessions sessions_insert_trigger; Type: TRIGGER; Schema: public; Owner: exchange
--

CREATE TRIGGER sessions_insert_trigger INSTEAD OF INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.insert_sessions_view();


--
-- Name: AuditEvent AuditEvent_actorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."AuditEvent"
    ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: LedgerAccount LedgerAccount_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."LedgerAccount"
    ADD CONSTRAINT "LedgerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: LedgerEntry LedgerEntry_ledgerAccountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."LedgerEntry"
    ADD CONSTRAINT "LedgerEntry_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES public."LedgerAccount"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Order Order_marketId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."Order"
    ADD CONSTRAINT "Order_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES public."Market"(id) ON UPDATE CASCADE;


--
-- Name: Order Order_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."Order"
    ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Session Session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON DELETE CASCADE;


--
-- Name: Trade Trade_marketId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."Trade"
    ADD CONSTRAINT "Trade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES public."Market"(id) ON UPDATE CASCADE;


--
-- Name: Trade Trade_orderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public."Trade"
    ADD CONSTRAINT "Trade_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public."Order"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: audit_events audit_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public."User"(id) ON DELETE SET NULL;


--
-- Name: email_verification_tokens email_verification_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE;


--
-- Name: ledger_accounts ledger_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.ledger_accounts
    ADD CONSTRAINT ledger_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE;


--
-- Name: ledger_entries ledger_entries_ledger_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_ledger_account_id_fkey FOREIGN KEY (ledger_account_id) REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT;


--
-- Name: login_history login_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.login_history
    ADD CONSTRAINT login_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE;


--
-- Name: order_requests order_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.order_requests
    ADD CONSTRAINT order_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exchange
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT ALL ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA public TO nexa_app;


--
-- Name: TABLE "AuditEvent"; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public."AuditEvent" TO app_user;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public."AuditEvent" TO nexa_app;


--
-- Name: TABLE "LedgerAccount"; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public."LedgerAccount" TO app_user;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public."LedgerAccount" TO nexa_app;


--
-- Name: TABLE "LedgerEntry"; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public."LedgerEntry" TO app_user;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public."LedgerEntry" TO nexa_app;


--
-- Name: TABLE "Market"; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public."Market" TO app_user;
GRANT ALL ON TABLE public."Market" TO nexa_app;


--
-- Name: TABLE "Order"; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public."Order" TO app_user;
GRANT ALL ON TABLE public."Order" TO nexa_app;


--
-- Name: TABLE "Session"; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public."Session" TO nexa_app;


--
-- Name: TABLE "Trade"; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public."Trade" TO app_user;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public."Trade" TO nexa_app;


--
-- Name: TABLE "User"; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public."User" TO app_user;
GRANT ALL ON TABLE public."User" TO nexa_app;


--
-- Name: TABLE audit_events; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public.audit_events TO nexa_app;


--
-- Name: TABLE email_verification_tokens; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public.email_verification_tokens TO nexa_app;


--
-- Name: TABLE ledger_accounts; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public.ledger_accounts TO nexa_app;


--
-- Name: TABLE ledger_entries; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public.ledger_entries TO nexa_app;


--
-- Name: TABLE login_history; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public.login_history TO nexa_app;


--
-- Name: TABLE markets; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public.markets TO nexa_app;


--
-- Name: TABLE order_requests; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public.order_requests TO nexa_app;


--
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public.orders TO nexa_app;


--
-- Name: TABLE password_reset_tokens; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public.password_reset_tokens TO nexa_app;


--
-- Name: TABLE sessions; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public.sessions TO nexa_app;


--
-- Name: TABLE trades; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public.trades TO nexa_app;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: exchange
--

GRANT ALL ON TABLE public.users TO nexa_app;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: exchange
--

ALTER DEFAULT PRIVILEGES FOR ROLE exchange IN SCHEMA public GRANT ALL ON TABLES TO nexa_app;


--
-- PostgreSQL database dump complete
--

\unrestrict feCZgq3T63upytyxcDjxjrDgoBK8lkTM4Tyq5Uzi4BHvYe4yTLQ5IvjlBKggCyy

