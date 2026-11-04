// Идентификаторы по умолчанию для самостоятельной регистрации.
//
// Это единственный источник значений для клиента. Они должны совпадать с
// константами в firestore.rules:
//   - orgId  — 'default-org'
//   - groupId — 'default-group'

export const DEFAULT_ORG_ID = "default-org";
export const DEFAULT_GROUP_ID = "default-group";

export const ORGANIZATION_CONFIG = {
  name: "Skillbase",
  version: "1.0.0",
  year: 2026,
  docVersion: "02.11.2026",
  author: "Independent Developers",
  defaultOrgId: DEFAULT_ORG_ID,
  defaultGroupId: DEFAULT_GROUP_ID
};
