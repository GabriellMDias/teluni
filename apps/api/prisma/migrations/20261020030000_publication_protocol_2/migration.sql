-- Publication protocol 2 (catalog and composition design, increment 3):
-- programs with a layout publish manifests of protocol 2, while programs
-- without one keep protocol 1.
ALTER TABLE "publications" DROP CONSTRAINT "publications_protocol_known";
ALTER TABLE "publications"
  ADD CONSTRAINT "publications_protocol_known" CHECK ("protocol" IN (1, 2));
