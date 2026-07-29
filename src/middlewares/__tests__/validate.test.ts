import { formatValidationErrors, validateDTO } from '../validate';
import { IsString, IsNotEmpty, IsNumber, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class TestArtistDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

class TestSongDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsNumber()
  @Min(1)
  duration!: number;

  @ValidateNested()
  @Type(() => TestArtistDto)
  artist!: TestArtistDto;
}

describe('validateDTO & formatValidationErrors', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('formats single-level validation errors correctly', () => {
    process.env.NODE_ENV = 'development';

    const errors = [
      {
        property: 'title',
        value: '',
        constraints: {
          isNotEmpty: 'title should not be empty',
        },
      },
    ] as any;

    const details = formatValidationErrors(errors);

    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      field: 'title',
      message: 'title should not be empty',
      value: '',
    });
  });

  it('supports dot notation for nested object validation errors', () => {
    process.env.NODE_ENV = 'development';

    const errors = [
      {
        property: 'artist',
        value: { name: '' },
        children: [
          {
            property: 'name',
            value: '',
            constraints: {
              isNotEmpty: 'name should not be empty',
            },
          },
        ],
      },
    ] as any;

    const details = formatValidationErrors(errors);

    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      field: 'artist.name',
      message: 'name should not be empty',
      value: '',
    });
  });

  it('omits original value from error details when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';

    const errors = [
      {
        property: 'title',
        value: 'secret-value',
        constraints: {
          isNotEmpty: 'title should not be empty',
        },
      },
    ] as any;

    const details = formatValidationErrors(errors);

    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      field: 'title',
      message: 'title should not be empty',
    });
    expect(details[0].value).toBeUndefined();
  });

  it('validateDTO middleware attaches transformed DTO and calls next() on valid input', async () => {
    const middleware = validateDTO(TestArtistDto);
    const req: any = { body: { name: 'Valid Artist' } };
    const res: any = {};
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body.name).toBe('Valid Artist');
  });
});
