# API

## Callable Functions

### createGame
- Creates a new game with initial FEN
- Returns: { gameId }

### joinGame
- Params: { gameId }
- Assigns player color and activates game when full

### submitMove
- Params: { gameId, uci, expectedVersion }
- Validates move, applies transaction, increments version
