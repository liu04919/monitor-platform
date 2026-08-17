package postgres

import "time"

// Project 是 PostgreSQL projects 表对应的 GORM 持久化模型。
// PublicKey 会暴露在浏览器中，只用于 SDK 上报接入控制。
type Project struct {
	ID        string    `gorm:"column:id;type:varchar(128);primaryKey"`
	Name      string    `gorm:"column:name;type:varchar(128);not null"`
	PublicKey string    `gorm:"column:public_key;type:varchar(128);not null;uniqueIndex"`
	Enabled   bool      `gorm:"column:enabled;not null"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`
}

func (Project) TableName() string {
	return "projects"
}
