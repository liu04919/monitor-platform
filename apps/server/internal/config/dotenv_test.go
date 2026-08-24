package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDotEnvLoadsFileWithoutOverridingProcessEnvironment(t *testing.T) {
	workspace := t.TempDir()
	serverDirectory := filepath.Join(workspace, "apps", "server")
	if err := os.MkdirAll(serverDirectory, 0o755); err != nil {
		t.Fatalf("创建测试目录: %v", err)
	}

	envFile := filepath.Join(workspace, ".env")
	envContent := "MONITOR_DOTENV_FILE_VALUE=from-file\nMONITOR_DOTENV_PRIORITY=from-file\n"
	if err := os.WriteFile(envFile, []byte(envContent), 0o600); err != nil {
		t.Fatalf("创建测试环境文件: %v", err)
	}

	previousWorkingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("获取测试工作目录: %v", err)
	}
	if err := os.Chdir(serverDirectory); err != nil {
		t.Fatalf("切换测试工作目录: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previousWorkingDirectory); err != nil {
			t.Errorf("恢复测试工作目录: %v", err)
		}
	})

	fileVariable := "MONITOR_DOTENV_FILE_VALUE"
	previousFileValue, fileVariableExisted := os.LookupEnv(fileVariable)
	if err := os.Unsetenv(fileVariable); err != nil {
		t.Fatalf("清理测试环境变量: %v", err)
	}
	t.Cleanup(func() {
		if fileVariableExisted {
			_ = os.Setenv(fileVariable, previousFileValue)
			return
		}
		_ = os.Unsetenv(fileVariable)
	})

	t.Setenv("MONITOR_DOTENV_PRIORITY", "from-process")

	if err := LoadDotEnv(); err != nil {
		t.Fatalf("LoadDotEnv() error = %v", err)
	}
	if got := os.Getenv(fileVariable); got != "from-file" {
		t.Fatalf("%s = %q, want %q", fileVariable, got, "from-file")
	}
	if got := os.Getenv("MONITOR_DOTENV_PRIORITY"); got != "from-process" {
		t.Fatalf("MONITOR_DOTENV_PRIORITY = %q, want %q", got, "from-process")
	}
}

func TestFindDotEnvFromNestedDirectory(t *testing.T) {
	workspace := t.TempDir()
	serverDirectory := filepath.Join(workspace, "apps", "server")
	if err := os.MkdirAll(serverDirectory, 0o755); err != nil {
		t.Fatalf("创建测试目录: %v", err)
	}

	envFile := filepath.Join(workspace, ".env")
	if err := os.WriteFile(envFile, []byte("DATABASE_URL=test\n"), 0o600); err != nil {
		t.Fatalf("创建测试环境文件: %v", err)
	}

	got, err := findDotEnv(serverDirectory)
	if err != nil {
		t.Fatalf("findDotEnv() error = %v", err)
	}
	if got != envFile {
		t.Fatalf("findDotEnv() = %q, want %q", got, envFile)
	}
}

func TestFindDotEnvReturnsEmptyWhenMissing(t *testing.T) {
	got, err := findDotEnv(t.TempDir())
	if err != nil {
		t.Fatalf("findDotEnv() error = %v", err)
	}
	if got != "" {
		t.Fatalf("findDotEnv() = %q, want empty", got)
	}
}
