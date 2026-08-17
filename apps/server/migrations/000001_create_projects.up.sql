CREATE TABLE projects (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    public_key VARCHAR(128) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- public_key 会暴露在浏览器中，只用于 SDK 上报接入控制，不能当作管理端 Secret。
COMMENT ON COLUMN projects.public_key IS
    '浏览器可见的公开上报 Key，不是管理端 Secret';
