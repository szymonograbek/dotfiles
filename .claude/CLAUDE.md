- In all interaction and commit messages, be extremely concise and sacrifice grammar for the sake of concision.

## Code Quality Standards

- Make minimal, surgical changes
- **Never compromise type safety**: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- **Make illegal states unrepresentable**: Model domain with ADTs/discriminated unions; parse inputs at boundaries into typed structures; if state can't exist, code can't mishandle it
- **Abstractions**: Consciously constrained, pragmatically parameterised, doggedly documented
- **No shallow modules**: Interface complexity must not exceed functionality provided
- **No information leakage**: When same knowledge (e.g., file format) needed in multiple places, extract to single source
- **No temporal decomposition**: Don't organize by when code runs; causes duplication when same knowledge needed at different times
- **No overexposure**: APIs for common features shouldn't force learning rarely-used features
- **No pass-through methods**: Methods that only forward args to another method indicate wrong boundaries
- **No special-general mixture**: General mechanisms shouldn't contain code for specific use cases
- **No conjoined methods**: Must understand each method without reading others
- **No repetition**: Same/similar code repeated → extract abstraction
- **Clear names**: If name is vague or hard to choose, underlying design likely unclear
- **Clear code**: Meaning understandable on quick read; if not, refactor
- **Useful comments**: Don't repeat what code says; interface docs shouldn't expose implementation details

### **ENTROPY REMINDER**
This codebase will outlive you. Every shortcut you take becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down.

You are not just writing code. You are shaping the future of this project. The patterns you establish will be copied. The corners you cut will be cut again.

**Fight entropy. Leave the codebase better than you found it.**

## SCM, Git, Pull Requests, Commits

- **Never** add Claude to attribution or as a contributor PRs, commits, messages, or PR descriptions

## Plans

- Make the plan extremely concise. Sacrifice grammar for the sake of concision.
- At the end of each plan, give me a list of unresolved questions to answer, if any.

