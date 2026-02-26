declare namespace google.accounts.oauth2 {
  interface TokenClient {
    requestAccessToken(config?: { prompt?: string }): void;
  }
  interface TokenResponse {
    access_token: string;
    error?: string;
  }
  function initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
  }): TokenClient;
  function revoke(token: string, callback: () => void): void;
}
