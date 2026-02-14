package com.example.devicemanager.repository;

import com.example.devicemanager.model.User;
import com.example.devicemanager.model.UserRole;
import com.example.devicemanager.model.UserStatus;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Repository
public class InMemoryUserRepository implements UserRepository {
    private final ConcurrentHashMap<String, User> users = new ConcurrentHashMap<>();

    public InMemoryUserRepository() {
        // Initialize with sample data
        User admin = new User(
                UUID.randomUUID().toString(),
                "admin",
                "admin@example.com",
                "System Administrator",
                UserRole.ADMIN,
                UserStatus.ACTIVE
        );
        admin.setLastLoginAt(Instant.now().minusSeconds(3600));
        users.put(admin.getId(), admin);

        User user1 = new User(
                UUID.randomUUID().toString(),
                "john.doe",
                "john.doe@example.com",
                "John Doe",
                UserRole.USER,
                UserStatus.ACTIVE
        );
        user1.setLastLoginAt(Instant.now().minusSeconds(7200));
        users.put(user1.getId(), user1);

        User user2 = new User(
                UUID.randomUUID().toString(),
                "jane.smith",
                "jane.smith@example.com",
                "Jane Smith",
                UserRole.USER,
                UserStatus.ACTIVE
        );
        user2.setLastLoginAt(Instant.now().minusSeconds(86400));
        users.put(user2.getId(), user2);

        User viewer = new User(
                UUID.randomUUID().toString(),
                "viewer",
                "viewer@example.com",
                "Guest Viewer",
                UserRole.VIEWER,
                UserStatus.INACTIVE
        );
        users.put(viewer.getId(), viewer);
    }

    @Override
    public List<User> findAll() {
        return users.values().stream()
                .sorted((u1, u2) -> u1.getCreatedAt().compareTo(u2.getCreatedAt()))
                .collect(Collectors.toList());
    }

    @Override
    public Optional<User> findById(String id) {
        return Optional.ofNullable(users.get(id));
    }

    @Override
    public Optional<User> findByUsername(String username) {
        return users.values().stream()
                .filter(user -> user.getUsername().equals(username))
                .findFirst();
    }

    @Override
    public Optional<User> findByEmail(String email) {
        return users.values().stream()
                .filter(user -> user.getEmail().equals(email))
                .findFirst();
    }

    @Override
    public List<User> findByStatus(UserStatus status) {
        return users.values().stream()
                .filter(user -> user.getStatus() == status)
                .collect(Collectors.toList());
    }

    @Override
    public User save(User user) {
        if (user.getId() == null || user.getId().isEmpty()) {
            user.setId(UUID.randomUUID().toString());
        }
        if (user.getCreatedAt() == null) {
            user.setCreatedAt(Instant.now());
        }
        users.put(user.getId(), user);
        return user;
    }

    @Override
    public void deleteById(String id) {
        users.remove(id);
    }

    @Override
    public boolean existsById(String id) {
        return users.containsKey(id);
    }

    @Override
    public boolean existsByUsername(String username) {
        return users.values().stream()
                .anyMatch(user -> user.getUsername().equals(username));
    }

    @Override
    public boolean existsByEmail(String email) {
        return users.values().stream()
                .anyMatch(user -> user.getEmail().equals(email));
    }
}
