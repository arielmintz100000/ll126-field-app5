// Central map of ClickUp custom field IDs.
// Pulled from the "Projects" and "Buildings" lists in Client Space.
// If a field is ever recreated in ClickUp its ID changes -- update it here only.

export const PROJECTS_LIST_ID = '1008924186312805496';
export const BUILDINGS_LIST_ID = '1008900917444879386';

export const PROJECT_FIELDS = {
  address:            '4a0d22c4-6ca8-4988-8b0e-7c8699d24ef0', // Location
  bbl:                'eecd4918-6da6-41ef-8d85-ea14140e1bda', // Number
  bin:                '6f7bc095-e095-44ff-ad43-7973c0c17f54', // Number
  dateOfInspection:   'c772070d-1ce6-43b2-8477-55c2a5652e37', // Date
  entity:             'd9759cde-e3ca-49c9-8b34-413ab28445c0', // Text
  clientContact:      '9f71b221-995d-4940-81c7-82fce1f79135', // Email
  billingAddress:     'b3e37e90-5b7d-4393-b60f-a6a921570f9a', // Text
  zip:                '21923d69-ebfb-4aba-ad2e-dae75cd341c2', // Text
  siteContact:        '1daf8d32-cd7d-41ef-92f3-0a16101e00d2', // Text  (shared with Buildings)
  phone:              'af79ffa8-7b6d-4690-bb27-b2d94ee4bc16', // Phone (shared with Buildings)
  buildingType:       '9fa52f30-d023-4b66-a29e-6b85c7727dfa', // Dropdown
  projectPhase:       'ac6371ec-a08b-44ac-8e1c-a169c9fd00c9', // Dropdown
  pastRepairs:        'ad436ee7-9679-4f04-83d2-5488babf0a48', // Long text
  parapetMaterials:   'd98f82bd-b202-4d6b-b090-66f8eb83f528', // Dropdown
  parapetScore:       'c279f792-c602-49c5-9aa2-d31125af6540', // Dropdown: Safe / SWARMP / Unsafe
  inspectorSignature: 'd039d94d-1f64-4eb7-ba6c-5680624fcf3d', // Signature
  video360:           '9268b177-ed1b-4618-8b23-8a9fa46b8dfd', // Attachment
  reportLink:         'a66c1de0-627c-4f2b-94e7-91340b5a6e57', // URL
};

export const ELEVATIONS = ['north', 'east', 'south', 'west'];

export const CONDITION_FIELDS = {
  north: 'fdace429-8650-4995-878a-bdb461b4f5bc',
  east:  '7ccad2e8-ba4a-4442-a74a-3fcc79482948',
  south: '7ba0e651-8eb6-4f69-9833-02e441c495d5',
  west:  'b52ffb81-026d-4b30-ae8c-1a89129d436a',
};

export const INFO_FIELDS = {
  north: '97b42dac-1323-4a8e-a6dc-7d0cbe3d064f',
  east:  '632cae26-5993-4d6e-857e-751550c507e8',
  south: '8d04ca19-eb02-4c02-a7b5-8ceab3f07a06',
  west:  '277a303b-3ca0-403e-a7e3-b703acb30c3e',
};

export const PHOTO_FIELDS = {
  north: 'f6402db5-64e9-4c43-9af1-9f23c1d62e9a',
  east:  '9e4633c2-4fd3-498a-ade1-81568b27d146',
  south: '80fd6d6e-78c3-4253-95fb-c816696f669d',
  west:  'f7e35a6b-0237-4a18-b26f-1803a30f94f9',
};

// Fields on the related Buildings record. The project task is matched to a
// building by BBL, so these can be pulled through without any ClickUp automation.
export const BUILDING_FIELDS = {
  bbl:             '9f5a3225-fda2-421a-a299-7d11c592a9a8',
  siteContact:     '1daf8d32-cd7d-41ef-92f3-0a16101e00d2',
  buildingType:    '7adabdf8-d914-436a-af2a-20d7a5211b55',
  phone:           'af79ffa8-7b6d-4690-bb27-b2d94ee4bc16',
  entity:          'd9759cde-e3ca-49c9-8b34-413ab28445c0',
  ownerContact:    'dd554fc5-91b8-43ad-a460-8be2a94d9257',
  managementCo:    'e4d00a09-1e92-404c-a8e8-f55f6e47285a',
  priorInspection: 'f7b59b3b-fa63-4f32-b237-091deff30e24',
};
