-- Runs once on first container start (alongside the POSTGRES_DB=app_dev
-- database Postgres creates automatically). Gives the test suite its own
-- database so `npm test` never touches development data.
CREATE DATABASE app_test OWNER app_user;
