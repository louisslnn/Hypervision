# Data Model

## Firestore

### games/{gameId}

- status: waiting | active | ended
- variant: standard
- whiteUid / blackUid
- fen, moveNumber, turn
- version
- result, endReason
- createdAt / updatedAt

### games/{gameId}/moves/{moveId}

- idx
- by: w | b
- uci / san
- fenAfter
- createdAt

### presence/{gameId}_{uid}

- uid
- gameId
- lastSeenAt
- connectionState
