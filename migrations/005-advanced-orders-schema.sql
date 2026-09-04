-- Phase 5: Advanced Orders Schema Migration
-- Stop-Loss, Take-Profit, Trailing Stops

CREATE TABLE advanced_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  
  -- Order classification
  order_type VARCHAR(20) NOT NULL CHECK (order_type IN ('STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP')),
  order_side VARCHAR(10) NOT NULL CHECK (order_side IN ('BUY', 'SELL')),
  
  -- Trigger configuration
  trigger_type VARCHAR(20) NOT NULL CHECK (trigger_type IN ('PRICE', 'PERCENTAGE', 'TRAIL')),
  trigger_value DECIMAL(28,8) NOT NULL,
  trail_percentage DECIMAL(5,2),
  
  -- Order details
  quantity DECIMAL(28,8) NOT NULL,
  linked_order_id UUID REFERENCES advanced_orders(id),
  
  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIGGERED', 'FILLED', 'CANCELED', 'EXPIRED')),
  triggered_price DECIMAL(28,8),
  triggered_at TIMESTAMP,
  
  -- Execution details
  fill_price DECIMAL(28,8),
  filled_quantity DECIMAL(28,8),
  filled_at TIMESTAMP,
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_advanced_orders_user_id ON advanced_orders(user_id);
CREATE INDEX idx_advanced_orders_market_id ON advanced_orders(market_id);
CREATE INDEX idx_advanced_orders_status ON advanced_orders(status);
CREATE INDEX idx_advanced_orders_user_status ON advanced_orders(user_id, status);

CREATE TABLE trailing_stop_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advanced_order_id UUID NOT NULL REFERENCES advanced_orders(id) ON DELETE CASCADE,
  previous_trigger DECIMAL(28,8),
  new_trigger DECIMAL(28,8) NOT NULL,
  market_price DECIMAL(28,8) NOT NULL,
  adjusted_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trailing_stop_history_order_id ON trailing_stop_history(advanced_order_id);

CREATE TABLE order_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  stop_loss_id UUID REFERENCES advanced_orders(id) ON DELETE SET NULL,
  take_profit_id UUID REFERENCES advanced_orders(id) ON DELETE SET NULL,
  trailing_stop_id UUID REFERENCES advanced_orders(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIGGERED', 'PARTIAL', 'COMPLETE', 'CANCELED')),
  triggered_by_order_id UUID REFERENCES advanced_orders(id),
  triggered_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_chains_user_id ON order_chains(user_id);
CREATE INDEX idx_order_chains_parent_trade_id ON order_chains(parent_trade_id);
CREATE INDEX idx_order_chains_status ON order_chains(status);

-- Add advanced order reference to ledger entries
ALTER TABLE ledger_entries ADD COLUMN advanced_order_id UUID REFERENCES advanced_orders(id) ON DELETE SET NULL;
ALTER TABLE ledger_entries ADD COLUMN order_chain_id UUID REFERENCES order_chains(id) ON DELETE SET NULL;

CREATE INDEX idx_ledger_advanced_order_id ON ledger_entries(advanced_order_id);
