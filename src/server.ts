import express, { type NextFunction, type Request, type Response } from 'express';

import { countTenders, findTenderById, listTenders } from './api/tenders-repository.js';

const PORT = Number(process.env.PORT ?? 3000);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const app = express();

function parseInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : null;
}

function sendError(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message } });
}

app.get('/tenders', async (request, response) => {
  const { limit = String(DEFAULT_LIMIT), offset = '0' } = request.query;
  const parsedLimit = parseInteger(limit, 1, MAX_LIMIT);
  const parsedOffset = parseInteger(offset, 0, Number.MAX_SAFE_INTEGER);
  if (parsedLimit === null || parsedOffset === null) {
    sendError(response, 400, 'bad_request', `limit must be an integer from 1 to ${MAX_LIMIT}, offset a non-negative integer`);
    return;
  }

  const [results, count] = await Promise.all([listTenders(parsedLimit, parsedOffset), countTenders()]);
  response.json({ results, count });
});

app.get('/tenders/:id', async (request, response) => {
  const id = parseInteger(request.params.id, 1, Number.MAX_SAFE_INTEGER);
  if (id === null) {
    sendError(response, 400, 'bad_request', 'id must be a positive integer');
    return;
  }

  const tender = await findTenderById(id);
  if (!tender) {
    sendError(response, 404, 'not_found', `Tender ${id} does not exist`);
    return;
  }
  response.json(tender);
});

// Express 5 forwards rejected handler promises here. Database errors are logged, never sent to clients.
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  sendError(response, 500, 'internal_error', 'Internal server error');
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
