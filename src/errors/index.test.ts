import { HttpException, ModelException, OauthAccessError } from './index';

describe('error models', () => {
  test('OauthAccessError stores message and OAuth code', () => {
    const err = new OauthAccessError('invalid grant', 'invalid_grant');
    expect(err.message).toBe('invalid grant');
    expect(err.oauthErrorCode).toBe('invalid_grant');
  });

  test('ModelException stores message', () => {
    const err = new ModelException('model failed');
    expect(err.message).toBe('model failed');
  });

  test('HttpException stores status and message', () => {
    const err = new HttpException(400, 'bad request');
    expect(err.status).toBe(400);
    expect(err.message).toBe('bad request');
  });
});
