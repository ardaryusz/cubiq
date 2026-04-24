# Security Policy

Cubiq is committed to user privacy and data security.

## Local Data
- **Database**: All your chat history, workspace organization, and settings are stored locally in a SQLite database at `%APPDATA%\com.cubiq.desktop\cubiq.db`.
- **No Cloud Sync**: Cubiq does not upload your data to any proprietary cloud service. Your conversations remain on your machine.

## API Key Management
- **Storage**: API keys are stored in the local SQLite database.
- **Exposure**: Never commit your `cubiq.db` file to a public repository. The `.gitignore` at the root of this repo is configured to ignore build artifacts and local databases.
- **Environment Variables**: You can use the `CUBIQ_DB_PATH` environment variable to move your database to a secure or encrypted volume if desired.

## Best Practices
- **Do not share installers**: Only download Cubiq installers from official sources.
- **Rotate keys**: If you suspect your local machine has been compromised, rotate your AI provider API keys immediately.
- **Reporting Vulnerabilities**: If you find a security bug, please report it via the repository's "Issues" or contact the maintainers directly.

## Environment Files
Cubiq does not currently use `.env` files for production secrets; all sensitive configuration is handled through the GUI Settings and stored in the local database.
