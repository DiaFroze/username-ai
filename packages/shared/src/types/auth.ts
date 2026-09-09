export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TelegramAuthPayload {
  initData: string;
}

export interface AuthSessionResponse {
  token: string;
  user: TelegramUser;
}

export interface CheckUsernameDto {
  username: string;
}
