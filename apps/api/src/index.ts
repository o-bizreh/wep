import 'dotenv/config';
import { createServer } from './server.js';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

const app = createServer();

app.listen(PORT, () => {
  console.log(`WEP API running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
