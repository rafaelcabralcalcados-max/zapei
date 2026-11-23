/**
 * Zapei Firestore Security Rules Verification Suite (Phase 0 TDD)
 * Validates all 12 adversarial payloads ("Dirty Dozen") against firestore.rules.
 */
export interface SecurityTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  expected: 'PERMISSION_DENIED';
  rationale: string;
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Shadow field injection on /users/{uid}',
    collectionPath: '/users/user_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Blocked by isValidUserPublic data.keys().hasOnly(...)',
  },
  {
    id: 2,
    name: 'Cross-user PII read on /users/{uid}/private/{id}',
    collectionPath: '/users/user_1/private/info',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    rationale: 'Blocked by isOwner(userId)',
  },
  {
    id: 3,
    name: 'Identity spoofing on /products/{id}',
    collectionPath: '/products/prod_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Blocked by incoming().factoryId == request.auth.uid',
  },
  {
    id: 4,
    name: 'Resource poisoning document ID (>128 chars or special chars)',
    collectionPath: '/products/invalid$id!with!bad!chars',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Blocked by isValidId(productId)',
  },
  {
    id: 5,
    name: 'Unbounded string payload on chat message text (>1000 chars)',
    collectionPath: '/chats/chat_1/messages/msg_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Blocked by data.text.size() <= 1000',
  },
  {
    id: 6,
    name: 'Client timestamp forgery on /orders/{id}',
    collectionPath: '/orders/order_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Blocked by incoming().createdAt == request.time',
  },
  {
    id: 7,
    name: 'Immutable field tampering on /orders/{id} (buyerId/createdAt)',
    collectionPath: '/orders/order_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    rationale: 'Blocked by incoming().buyerId == existing().buyerId && affectedKeys().hasOnly(...)',
  },
  {
    id: 8,
    name: 'Terminal state bypass on completed order',
    collectionPath: '/orders/order_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    rationale: 'Blocked by !(existing().status in [completed, cancelled])',
  },
  {
    id: 9,
    name: 'Value poisoning on whitelisted stockBoxes field (string instead of number)',
    collectionPath: '/products/prod_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    rationale: 'Blocked by isValidProduct(incoming()) enforcing data.stockBoxes is number',
  },
  {
    id: 10,
    name: 'Orphaned chat message without existing parent chat',
    collectionPath: '/chats/missing_chat/messages/msg_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Blocked by Master Gate exists(/databases/$(database)/documents/chats/$(chatId))',
  },
  {
    id: 11,
    name: 'Dual financial layer tampering by non-owner',
    collectionPath: '/payments/pay_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    rationale: 'Blocked by existing().ownerId == request.auth.uid',
  },
  {
    id: 12,
    name: 'Blanket list scraping on /chats/{id}/messages by non-participant',
    collectionPath: '/chats/chat_1/messages',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    rationale: 'Blocked by existing().chatOwnerId == request.auth.uid || existing().chatParticipantId == request.auth.uid',
  },
];
