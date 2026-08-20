import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export interface ValidateDtoResult<T> {
  value: T | null;
  errors: string[];
}

// Validates an untrusted socket payload against a DTO before any business logic
// touches it — mirrors the REST side's ValidationPipe, but done inline since Nest's
// pipe/filter machinery is built around HTTP error shapes, not our WS event contracts.
export async function validateDto<T extends object>(
  cls: new () => T,
  plain: unknown,
): Promise<ValidateDtoResult<T>> {
  const instance = plainToInstance(
    cls,
    typeof plain === 'object' && plain !== null ? plain : {},
  );
  const validationErrors = await validate(instance, { whitelist: true });

  if (validationErrors.length === 0) {
    return { value: instance, errors: [] };
  }
  const errors = validationErrors.flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
  return { value: null, errors };
}
