package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
)

// LoadDotEnv 从当前目录开始向上查找 .env，并将其中尚未设置的变量载入当前进程。
// 生产环境已经注入的变量优先，不会被本地文件覆盖。
func LoadDotEnv() error {
	workingDirectory, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("获取当前工作目录: %w", err)
	}

	envFile, err := findDotEnv(workingDirectory)
	if err != nil {
		return err
	}
	if envFile == "" {
		return nil
	}

	if err := godotenv.Load(envFile); err != nil {
		return fmt.Errorf("读取环境文件 %s: %w", envFile, err)
	}

	return nil
}

func findDotEnv(startDirectory string) (string, error) {
	directory, err := filepath.Abs(startDirectory)
	if err != nil {
		return "", fmt.Errorf("解析工作目录 %s: %w", startDirectory, err)
	}

	for {
		envFile := filepath.Join(directory, ".env")
		info, statErr := os.Stat(envFile)
		switch {
		case statErr == nil:
			if info.IsDir() {
				return "", fmt.Errorf("环境文件路径是目录: %s", envFile)
			}

			return envFile, nil
		case errors.Is(statErr, fs.ErrNotExist):
			// 继续向父目录查找，兼容从仓库根目录或 apps/server 启动。
		default:
			return "", fmt.Errorf("检查环境文件 %s: %w", envFile, statErr)
		}

		parent := filepath.Dir(directory)
		if parent == directory {
			return "", nil
		}
		directory = parent
	}
}
