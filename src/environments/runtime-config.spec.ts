import { deploymentConfig } from './runtime-config';

describe('Gokul deployment configuration', () => {
  const defaults = { apiUrl: '/api', frontendUrl: 'https://gokul.example', socketUrl: 'https://gokul.example' };
  afterEach(() => { delete window.GOKUL_CONFIG; });

  it('uses the deployment origin defaults without a runtime override', () => {
    expect(deploymentConfig(defaults)).toEqual(defaults);
  });

  it('uses independent hosted services and avoids duplicate URL separators', () => {
    window.GOKUL_CONFIG = { apiUrl: 'https://api.gokul.example/api/', socketUrl: 'https://socket.gokul.example/' };
    expect(deploymentConfig(defaults)).toEqual({
      apiUrl: 'https://api.gokul.example/api',
      frontendUrl: defaults.frontendUrl,
      socketUrl: 'https://socket.gokul.example'
    });
  });

  it('keeps working defaults when optional fields are empty', () => {
    window.GOKUL_CONFIG = { apiUrl: '', frontendUrl: '', socketUrl: '' };
    expect(deploymentConfig(defaults)).toEqual(defaults);
  });
});
