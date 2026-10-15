// Chats that already have a live thread in this session, with the setup it
// runs on. Others (or a chat whose model changed) get their earlier transcript
// replayed so conversations survive restarts, model switches and reopening an
// older conversation from the history.
export const warm = new Map<string, string>()
