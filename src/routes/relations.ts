import { type Response } from 'express';
import { Prisma } from '../generated/prisma/client.ts';

export class RequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function validIdList(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((id) => typeof id === 'string' && Boolean(id.trim())) &&
    new Set(value).size === value.length;
}

export function handleRelationError(error: unknown, res: Response): void {
  if (error instanceof RequestError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2025' || error.code === 'P2003')) {
    res.status(404).json({ error: 'Recurso relacionado no encontrado.' });
    return;
  }
  console.error('Error al procesar la solicitud:', error);
  res.status(500).json({ error: 'No se pudo procesar la solicitud.' });
}
