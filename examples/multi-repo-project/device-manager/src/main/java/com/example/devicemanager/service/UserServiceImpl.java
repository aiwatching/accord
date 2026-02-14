package com.example.devicemanager.service;

import com.example.devicemanager.dto.BatchDeleteRequest;
import com.example.devicemanager.dto.BatchDeleteResponse;
import com.example.devicemanager.model.User;
import com.example.devicemanager.model.UserStatus;
import com.example.devicemanager.repository.UserRepository;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Service
public class UserServiceImpl implements UserService {
    private final UserRepository userRepository;

    public UserServiceImpl(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public List<User> getAllUsers() {
        return userRepository.findAll();
    }

    @Override
    public Optional<User> getUserById(String id) {
        return userRepository.findById(id);
    }

    @Override
    public Optional<User> getUserByUsername(String username) {
        return userRepository.findByUsername(username);
    }

    @Override
    public List<User> getUsersByStatus(UserStatus status) {
        return userRepository.findByStatus(status);
    }

    @Override
    public User createUser(User user) {
        if (userRepository.existsByUsername(user.getUsername())) {
            throw new IllegalArgumentException("Username already exists: " + user.getUsername());
        }
        if (userRepository.existsByEmail(user.getEmail())) {
            throw new IllegalArgumentException("Email already exists: " + user.getEmail());
        }
        return userRepository.save(user);
    }

    @Override
    public User updateUser(String id, User user) {
        User existingUser = userRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + id));

        if (user.getUsername() != null && !user.getUsername().equals(existingUser.getUsername())) {
            if (userRepository.existsByUsername(user.getUsername())) {
                throw new IllegalArgumentException("Username already exists: " + user.getUsername());
            }
            existingUser.setUsername(user.getUsername());
        }

        if (user.getEmail() != null && !user.getEmail().equals(existingUser.getEmail())) {
            if (userRepository.existsByEmail(user.getEmail())) {
                throw new IllegalArgumentException("Email already exists: " + user.getEmail());
            }
            existingUser.setEmail(user.getEmail());
        }

        if (user.getFullName() != null) {
            existingUser.setFullName(user.getFullName());
        }
        if (user.getRole() != null) {
            existingUser.setRole(user.getRole());
        }
        if (user.getStatus() != null) {
            existingUser.setStatus(user.getStatus());
        }
        if (user.getLastLoginAt() != null) {
            existingUser.setLastLoginAt(user.getLastLoginAt());
        }

        return userRepository.save(existingUser);
    }

    @Override
    public boolean deleteUser(String id) {
        if (!userRepository.existsById(id)) {
            return false;
        }
        userRepository.deleteById(id);
        return true;
    }

    @Override
    public BatchDeleteResponse batchDeleteUsers(BatchDeleteRequest request) {
        List<String> deleted = new ArrayList<>();
        List<BatchDeleteResponse.BatchDeleteError> failed = new ArrayList<>();

        for (String userId : request.getDeviceIds()) {
            try {
                if (deleteUser(userId)) {
                    deleted.add(userId);
                } else {
                    failed.add(new BatchDeleteResponse.BatchDeleteError(userId, "User not found"));
                }
            } catch (Exception e) {
                failed.add(new BatchDeleteResponse.BatchDeleteError(userId, e.getMessage()));
            }
        }

        return new BatchDeleteResponse(
                failed.isEmpty(),
                deleted,
                failed,
                request.getDeviceIds().size(),
                deleted.size()
        );
    }
}
