package postgres

import "time"

type User struct {
	ID           string    `gorm:"column:id;type:uuid;primaryKey"`
	Email        string    `gorm:"column:email;type:varchar(254);not null;uniqueIndex"`
	PasswordHash string    `gorm:"column:password_hash;type:text;not null"`
	CreatedAt    time.Time `gorm:"column:created_at;not null"`
	UpdatedAt    time.Time `gorm:"column:updated_at;not null"`
}

func (User) TableName() string {
	return "users"
}
