CREATE INDEX orders_requester_created_idx ON orders (requester_id, created_at DESC);
CREATE INDEX orders_resolved_at_idx ON orders (resolved_at) WHERE status = 'RESOLVED';

CREATE FUNCTION notify_order_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  service_order orders%ROWTYPE;
  previous_technician UUID;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    service_order := NEW;
    IF TG_OP = 'UPDATE' THEN
      IF OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
      previous_technician := OLD.technician_id;
    END IF;
  ELSE
    SELECT * INTO service_order FROM orders WHERE id = NEW.order_id;
  END IF;
  PERFORM pg_notify('os_changes', json_build_object(
    'orderId', service_order.id,
    'number', service_order.number,
    'requesterId', service_order.requester_id,
    'technicianId', service_order.technician_id,
    'previousTechnicianId', previous_technician,
    'kind', CASE WHEN TG_TABLE_NAME = 'orders' AND TG_OP = 'INSERT' THEN 'opened' ELSE 'changed' END
  )::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_notify AFTER INSERT OR UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION notify_order_change();
CREATE TRIGGER confirmation_email_notify AFTER UPDATE OF email_status ON confirmations
FOR EACH ROW WHEN (OLD.email_status IS DISTINCT FROM NEW.email_status)
EXECUTE FUNCTION notify_order_change();
