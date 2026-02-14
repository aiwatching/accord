package com.example.devicemanager.repository;

import com.example.devicemanager.model.User;
import com.example.devicemanager.model.UserStatus;

import java.util.List;
import java.util.Optional;

public interface UserRepository {
    List<User> findAll();
    Optional<User> findById(String id);
    Optional<User> findByUsername(String username);
    Optional<User> findByEmail(String email);
    List<User> findByStatus(UserStatus status);
    User save(User user);
    void deleteById(String id);
    boolean existsById(String id);
    boolean existsByUsername(String username);
    boolean existsByEmail(String email);
}
