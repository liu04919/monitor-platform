// postgres 包提供编译进迁移命令的 PostgreSQL SQL 文件。
package postgres

import (
	"embed"
	"io/fs"
)

//go:embed *.up.sql
var files embed.FS

// Files 返回只读的 PostgreSQL 向上迁移文件系统。
func Files() fs.FS {
	return files
}
