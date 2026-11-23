# Zapei Firestore Security Specification (Phase 0 TDD)

## Data Invariants
1. **PII Isolation**: `phone`, `email`, and `deliveryAddress` live strictly in `/users/{userId}/private/{privateId}` and are readable/writable only by `request.auth.uid == userId`.
2. **Master Gate on Chat Messages**: A message under `/chats/{chatId}/messages/{messageId}` requires the parent `/chats/{chatId}` document to exist and include `request.auth.uid` as either `ownerId` or `participantId`.
3. **Identity Integrity**: Creators cannot spoof `uid`, `ownerId`, `factoryId`, `resellerId`, `buyerId`, or `senderId`.
4. **Terminal State Locking**: Orders and sub-orders in `completed` or `cancelled` status reject further updates.
5. **Strict Action Allowlists & Validation Helpers**: Every update invokes `isValid[Entity](incoming())` and restricts mutated keys with `incoming().diff(existing()).affectedKeys().hasOnly(...)`.
6. **Temporal Integrity**: `createdAt == request.time` on create; `updatedAt == request.time` on update; `createdAt` is immutable.
7. **Secure List Queries**: Every `allow list` validates `resource.data` against `request.auth.uid` (or public visibility flags on products/public storefronts) without `get()`/`exists()` inside list rules.

## The "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on User**: `users/u1` create with extra `isAdmin: true`.
2. **Cross-User PII Read**: `u2` reading `/users/u1/private/info`.
3. **Identity Spoofing on Product**: `u2` creating `/products/p1` with `factoryId: "u1"`.
4. **Resource Poisoning ID**: Writing `/products/` with a 200-char invalid ID containing `$` or spaces.
5. **Unbounded String Attack**: Creating chat message with 5000-character `text`.
6. **Client Timestamp Forgery**: Creating `/orders/o1` with backdated `createdAt`.
7. **Immutable Field Tampering**: Updating `/orders/o1` to mutate `buyerId` or `createdAt`.
8. **Terminal State Bypass**: Updating `/orders/o1` whose existing `status == "completed"`.
9. **Value Poisoning on Whitelisted Key**: Updating `/products/p1` `stockBoxes` to a string `"999"`.
10. **Orphaned Chat Message**: Creating `/chats/nonexistent/messages/m1` without an existing parent chat.
11. **Dual Financial Layer Tampering**: Buyer attempting to update `factory_reseller` payment owned by manufacturer.
12. **Blanket List Scraping**: Unauthenticated or non-participant listing `/chats` or `/orders`.
