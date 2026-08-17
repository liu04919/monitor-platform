// clickhouse 包提供编译进迁移命令的 ClickHouse SQL 文件。
package clickhouse

import (
	"embed"
	"io/fs"
)

//go:embed *.sql
var files embed.FS

// Files 返回只读的 ClickHouse 向上迁移文件系统。
func Files() fs.FS {
	return files
}
