-- Sabacos: profile photo from Telegram
alter table public.profiles add column if not exists photo_url text;
