import { randomBytes, scrypt, timingSafeEqual,  } from 'node:crypto';
import { Router, type Response } from 'express';
import { Prisma } from '../generated/prisma/client.ts';
import { prisma } from '../prisma.ts';
import { taskInclude, taskResponse } from '../taskResponse.ts';

export const authRouter = Router();

const userFields = { id: true, name: true, email: true, photoUrl: true } satisfies Prisma.UserSelect;

function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(`scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`);
      }
    });
  });
}

function validatePassword(tryPassword: string, storedPassword: string): Promise<boolean>{
    return new Promise((resolve, reject) => {
        const parts = storedPassword.split('$');
        if(parts.length !== 6 || parts[0] !== 'scrypt') {
            return resolve(false);
        }

        const N = Number(parts[1]);
        const r = Number(parts[2]);
        const p = Number(parts[3]);

        const salt = Buffer.from(parts[4], 'hex');
        const storedKey = Buffer.from(parts[5], 'hex');

        // Validar que los parametros sea correctos
        if(
            !Number.isInteger(N) ||
            !Number.isInteger(r) ||
            !Number.isInteger(p) ||
            salt.length === 0 ||
            storedKey.length === 0
        ){
            return resolve(false);
        }

        scrypt(
            tryPassword,
            salt,
            storedKey.length,
            {
                N,
                r,
                p,
                maxmem: 64 * 1024 * 1024
            },
            (error, key) => {
                if(error){
                    return reject(error);
                }

                // comparación segura de hashes
                resolve(
                    timingSafeEqual(
                        key,
                        storedKey
                    )
                )
            }
        )
    })
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 1024 && Array.from(value).length >= 8;
}

function validPhotoUrl(value: unknown): value is string {
  return typeof value === 'string' && isHttpUrl(value);
}

function handleDatabaseError(error: unknown, res: Response): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'El correo electrónico ya está registrado.' });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }
  }
  console.error('Error al procesar usuarios:', error);
  res.status(500).json({ error: 'No se pudo procesar la solicitud.' });
}


authRouter.post('/login', async (req, res) => {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Se requiere un objeto JSON.' });
    return;
  }

  const { name, password } = body as Record<string, unknown>;
  if (
    !validName(name) ||
    !validPassword(password)
  ) {
    res.status(400).json({ error: 'Error en el nombre de usuario o constraseña.' });
    return;
  }

  try {
    const user = await prisma.user.findFirst({
      select: {
        passwordHash: true
      },
      where: {
        name: name
      }
    });

    let valid = false;
    if(await validatePassword(password, user?.passwordHash || '')){
        valid = true;
    }

    res.status(201).json({
        success: true,
        access: valid
    });
  } catch (error) {
    handleDatabaseError(error, res);
  }
});