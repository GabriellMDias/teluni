-- Expand only; apply before the API that writes event-time device audit scope.
-- No existing event is changed. Old writers leave unknown scope, visible only
-- to company administrators. Never infer past scope from a device's current branch.
-- The new table starts empty; backfill scans immutable event details and joins
-- same-company branches. Production scan/lock duration is not qualified locally.
CREATE TABLE device_audit_event_branches (
  company_id UUID NOT NULL,
  event_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  CONSTRAINT device_audit_event_branches_pkey PRIMARY KEY (event_id, branch_id),
  CONSTRAINT device_audit_event_branches_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT device_audit_event_branches_company_id_event_id_fkey FOREIGN KEY (company_id, event_id) REFERENCES device_audit_events(company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT device_audit_event_branches_company_id_branch_id_fkey FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX device_audit_event_branches_branch_idx ON device_audit_event_branches(company_id, branch_id);

-- Only explicit immutable scope is backfilled. Other historical events remain
-- available to company administrators, without guessing a branch or timestamp order.
INSERT INTO device_audit_event_branches (company_id, event_id, branch_id)
SELECT e.company_id, e.id, b.id
FROM device_audit_events e
JOIN branches b ON b.company_id = e.company_id AND (
  (e.action IN ('device.paired', 'device.unlinked') AND b.id::text = e.details->>'branchId')
  OR (e.action = 'device.moved' AND b.id::text IN (e.details->>'fromBranchId', e.details->>'toBranchId'))
)
WHERE e.action <> 'device.moved' OR (
  EXISTS (SELECT 1 FROM branches f WHERE f.company_id = e.company_id AND f.id::text = e.details->>'fromBranchId')
  AND EXISTS (SELECT 1 FROM branches t WHERE t.company_id = e.company_id AND t.id::text = e.details->>'toBranchId')
);
