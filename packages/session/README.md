# @dojops/session

Interactive AI chat session management for [DojOps](https://github.com/dojops/dojops).

## Features

- Multi-turn conversation support with context preservation
- Session persistence and retrieval
- Agent routing within chat context
- Session CRUD operations (create, list, get, delete)

## Usage

```bash
# Via CLI
dojops chat

# Via API
POST /api/chat          # Send a message
POST /api/chat/sessions # Create a session
GET  /api/chat/sessions # List sessions
```

## Part of DojOps

This package is part of the [DojOps](https://github.com/dojops/dojops) monorepo. See the main repo for full documentation.

## License

MIT
